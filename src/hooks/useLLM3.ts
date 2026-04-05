'use client';

/**
 * useLLM.ts
 * Streams from /api/generate. Passes customFrogId when the active frog
 * is a custom frog so the server can use the right API key / provider.
 */

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage } from '@/lib/gemmaPrompt';
import type { FrogConfig }  from '@/lib/frogs';
import type { OneShotPrompt, ImagePrompt } from '@/lib/promptTypes';
import { extractDbId } from '@/lib/customFrog';

// ─── Types ────────────────────────────────────────────────────────────────────

export type LLMStatus = 'ready' | 'generating' | 'interrupting' | 'error';

export interface UseLLMReturn {
  status:       LLMStatus;
  statusMessage: string;
  error:        string | null;
  history:      ChatMessage[];
  generate:           (userMessage: string, onToken: (t: string, done: boolean) => void, contextSuffix?: string) => Promise<void>;
  generateOneShot:    (prompt: OneShotPrompt,  onToken: (t: string, done: boolean) => void) => Promise<void>;
  generateImageReaction: (prompt: ImagePrompt, onToken: (t: string, done: boolean) => void) => Promise<void>;
  clearHistory: () => void;
}

// ─── SSE streaming helper ─────────────────────────────────────────────────────

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
    const text = await res.text().catch(() => `HTTP ${res.status}`);
    throw new Error(text);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer    = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') { onToken('', true); return; }
        try {
          const p = JSON.parse(payload) as { text?: string; error?: string };
          if (p.error) throw new Error(p.error);
          if (p.text)  onToken(p.text, false);
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  onToken('', true);
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useLLM(activeFrog: FrogConfig): UseLLMReturn {
  const [statusState, setStatusState] = useState<LLMStatus>('ready');
  const [error,       setError]       = useState<string | null>(null);
  const [history,     setHistory]     = useState<ChatMessage[]>(activeFrog.seedHistory);
  const statusRef = useRef<LLMStatus>('ready');

  // Derive customFrogId from the active frog's id
  const customFrogDbId = extractDbId(activeFrog.id) ? activeFrog.id : undefined;

  const setStatus = useCallback((s: LLMStatus) => {
    statusRef.current = s; setStatusState(s);
  }, []);

  // ── generate (chat) ────────────────────────────────────────────────────────

  const generate = useCallback(async (
    userMessage: string,
    onToken: (t: string, done: boolean) => void,
    contextSuffix?: string
  ) => {
    if (statusRef.current !== 'ready') return;
    setStatus('generating');

    const systemPrompt = contextSuffix
      ? `${activeFrog.systemPrompt}${contextSuffix}`
      : activeFrog.systemPrompt;

    let fullResponse = '';
    const tracking = (token: string, done: boolean) => {
      fullResponse += token; onToken(token, done);
    };

    try {
      await streamFromProxy({
        type: 'chat', systemPrompt, history, userMessage,
        topK: activeFrog.topK,
        ...(customFrogDbId ? { customFrogId: customFrogDbId } : {}),
      }, tracking);

      setHistory(prev => [
        ...prev,
        { role: 'user'  as const, content: userMessage    },
        { role: 'model' as const, content: fullResponse },
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg); setStatus('error'); onToken('', true); return;
    }
    setStatus('ready');
  }, [activeFrog, history, customFrogDbId, setStatus]);

  // ── generateOneShot ────────────────────────────────────────────────────────

  const generateOneShot = useCallback(async (
    prompt: OneShotPrompt,
    onToken: (t: string, done: boolean) => void
  ) => {
    if (statusRef.current !== 'ready') return;
    setStatus('interrupting');
    try {
      await streamFromProxy({
        type: 'oneshot',
        systemPrompt: prompt.systemPrompt,
        userContext:  prompt.userContext,
        ...(customFrogDbId ? { customFrogId: customFrogDbId } : {}),
      }, onToken);
    } catch { onToken('', true); }
    finally   { setStatus('ready'); }
  }, [customFrogDbId, setStatus]);

  // ── generateImageReaction ──────────────────────────────────────────────────

  const generateImageReaction = useCallback(async (
    prompt: ImagePrompt,
    onToken: (t: string, done: boolean) => void
  ) => {
    if (statusRef.current !== 'ready') return;
    setStatus('interrupting');
    try {
      await streamFromProxy({
        type: 'image',
        systemPrompt: prompt.systemPrompt,
        userContext:  prompt.userContext,
        imageDataUrl: prompt.imageDataUrl,
        ...(customFrogDbId ? { customFrogId: customFrogDbId } : {}),
      }, onToken);
    } catch { onToken('', true); }
    finally   { setStatus('ready'); }
  }, [customFrogDbId, setStatus]);

  // ── clearHistory ───────────────────────────────────────────────────────────

  const clearHistory = useCallback(() => {
    setHistory(activeFrog.seedHistory);
  }, [activeFrog.seedHistory]);

  const statusMessage =
    statusState === 'generating'   ? 'generating...'    :
    statusState === 'interrupting' ? 'pond stirs...'    :
    statusState === 'error'        ? 'pond error'       : 'ready';

  return { status: statusState, statusMessage, error, history, generate, generateOneShot, generateImageReaction, clearHistory };
}
