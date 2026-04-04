'use client';

/**
 * useLLM.ts
 *
 * Replaces the MediaPipe/WebGPU local inference hook with a thin client
 * that streams from our /api/generate proxy (Gemini 2.5 Flash).
 *
 * The external interface is intentionally kept compatible so FrogChat.tsx
 * needs only minimal updates:
 *   - generate()              — multi-turn chat
 *   - generateOneShot()       — one-shot for interruptions/silence/poke/debate
 *   - generateImageReaction() — multimodal one-shot for image drops
 *   - clearHistory()          — reset conversation
 */

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/gemmaPrompt';
import type { FrogConfig } from '@/lib/frogs';
import type { OneShotPrompt, ImagePrompt } from '@/lib/promptTypes';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LLMStatus = 'ready' | 'generating' | 'interrupting' | 'error';

export interface UseLLMReturn {
  status: LLMStatus;
  statusMessage: string;
  error: string | null;
  history: ChatMessage[];
  generate: (
    userMessage: string,
    onToken: (token: string, done: boolean) => void,
    contextSuffix?: string
  ) => Promise<void>;
  generateOneShot: (
    prompt: OneShotPrompt,
    onToken: (token: string, done: boolean) => void
  ) => Promise<void>;
  generateImageReaction: (
    prompt: ImagePrompt,
    onToken: (token: string, done: boolean) => void
  ) => Promise<void>;
  clearHistory: () => void;
}

// ─── SSE streaming helper ─────────────────────────────────────────────────────

/**
 * POSTs `body` to /api/generate and reads the SSE stream,
 * calling onToken(chunk, false) for each text chunk and onToken('', true) when done.
 */
async function streamFromProxy(
  body: object,
  onToken: (token: string, done: boolean) => void
): Promise<void> {
  const res = await fetch('/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(errText);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();

        if (payload === '[DONE]') {
          onToken('', true);
          return;
        }

        try {
          const parsed = JSON.parse(payload) as { text?: string; error?: string };
          if (parsed.error) throw new Error(parsed.error);
          if (parsed.text) onToken(parsed.text, false);
        } catch (e) {
          // Skip malformed SSE lines, re-throw real errors
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // Stream ended without [DONE] — still signal completion
  onToken('', true);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLLM(activeFrog: FrogConfig): UseLLMReturn {
  const [statusState, setStatusState] = useState<LLMStatus>('ready');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>(activeFrog.seedHistory);

  // Use a ref so that async callbacks always see the latest status
  // without needing it as a useCallback dependency (which would cause churn)
  const statusRef = useRef<LLMStatus>('ready');

  const setStatus = useCallback((s: LLMStatus) => {
    statusRef.current = s;
    setStatusState(s);
  }, []);

  // ── generate ────────────────────────────────────────────────────────────────

  const generate = useCallback(
    async (
      userMessage: string,
      onToken: (token: string, done: boolean) => void,
      contextSuffix?: string
    ): Promise<void> => {
      if (statusRef.current !== 'ready') return;
      setStatus('generating');

      const systemPrompt = contextSuffix
        ? `${activeFrog.systemPrompt}${contextSuffix}`
        : activeFrog.systemPrompt;

      let fullResponse = '';
      const trackingOnToken = (token: string, done: boolean) => {
        fullResponse += token;
        onToken(token, done);
      };

      try {
        await streamFromProxy(
          {
            type: 'chat',
            systemPrompt,
            history,
            userMessage,
            topK: activeFrog.topK,
          },
          trackingOnToken
        );

        setHistory((prev) => [
          ...prev,
          { role: 'user' as const, content: userMessage },
          { role: 'model' as const, content: fullResponse },
        ]);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setStatus('error');
        onToken('', true);
        return;
      }

      setStatus('ready');
    },
    [activeFrog, history, setStatus]
  );

  // ── generateOneShot ─────────────────────────────────────────────────────────

  const generateOneShot = useCallback(
    async (
      prompt: OneShotPrompt,
      onToken: (token: string, done: boolean) => void
    ): Promise<void> => {
      if (statusRef.current !== 'ready') return;
      setStatus('interrupting');

      try {
        await streamFromProxy(
          {
            type: 'oneshot',
            systemPrompt: prompt.systemPrompt,
            userContext: prompt.userContext,
          },
          onToken
        );
      } catch {
        // Silent fail for side-channel generations; signal done so typing buffer
        // drains and the UI unblocks
        onToken('', true);
      } finally {
        setStatus('ready');
      }
    },
    [setStatus]
  );

  // ── generateImageReaction ───────────────────────────────────────────────────

  const generateImageReaction = useCallback(
    async (
      prompt: ImagePrompt,
      onToken: (token: string, done: boolean) => void
    ): Promise<void> => {
      if (statusRef.current !== 'ready') return;
      setStatus('interrupting');

      try {
        await streamFromProxy(
          {
            type: 'image',
            systemPrompt: prompt.systemPrompt,
            userContext: prompt.userContext,
            imageDataUrl: prompt.imageDataUrl,
          },
          onToken
        );
      } catch {
        onToken('', true);
      } finally {
        setStatus('ready');
      }
    },
    [setStatus]
  );

  // ── clearHistory ────────────────────────────────────────────────────────────

  const clearHistory = useCallback(() => {
    setHistory(activeFrog.seedHistory);
  }, [activeFrog.seedHistory]);

  // ── Return ──────────────────────────────────────────────────────────────────

  const statusMessage =
    statusState === 'generating'   ? 'generating...'      :
    statusState === 'interrupting' ? 'something stirs...' :
    statusState === 'error'        ? 'pond error'         :
    'ready';

  return {
    status: statusState,
    statusMessage,
    error,
    history,
    generate,
    generateOneShot,
    generateImageReaction,
    clearHistory,
  };
}