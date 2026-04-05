'use client';

import { useCallback, useRef, useState } from 'react';
import type { ChatMessage }   from '@/lib/gemmaPrompt';
import type { FrogConfig }    from '@/lib/frogs';
import type { OneShotPrompt, ImagePrompt } from '@/lib/promptTypes';
import { extractDbId }        from '@/lib/customFrog';
import { oneShotQueue, requestBudget } from '@/lib/requestQueue';

export type LLMStatus = 'ready' | 'generating' | 'interrupting' | 'error';

export interface UseLLMReturn {
  status:        LLMStatus;
  statusMessage: string;
  error:         string | null;
  history:       ChatMessage[];
  generate:              (userMessage: string, onToken: (t: string, done: boolean) => void, contextSuffix?: string) => Promise<void>;
  generateOneShot:       (prompt: OneShotPrompt, onToken: (t: string, done: boolean) => void) => Promise<void>;
  generateImageReaction: (prompt: ImagePrompt,   onToken: (t: string, done: boolean) => void) => Promise<void>;
  clearHistory: () => void;
}

async function streamFromProxy(body: object, onToken: (t: string, done: boolean) => void): Promise<void> {
  const res = await fetch('/api/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
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
        } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
      }
    }
  } finally { reader.releaseLock(); }
  onToken('', true);
}

export function useLLM(activeFrog: FrogConfig): UseLLMReturn {
  const [statusState, setStatusState] = useState<LLMStatus>('ready');
  const [error,       setError]       = useState<string | null>(null);
  const [history,     setHistory]     = useState<ChatMessage[]>(activeFrog.seedHistory);
  const statusRef = useRef<LLMStatus>('ready');

  const customFrogDbId = extractDbId(activeFrog.id) ? activeFrog.id : undefined;
  const extra = customFrogDbId ? { customFrogId: customFrogDbId } : {};

  const setStatus = useCallback((s: LLMStatus) => {
    statusRef.current = s; setStatusState(s);
  }, []);

  // Chat — immediate, no queue (user is waiting)
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
    try {
      requestBudget.record();
      await streamFromProxy(
        { type: 'chat', systemPrompt, history, userMessage, topK: activeFrog.topK, ...extra },
        (t, done) => { fullResponse += t; onToken(t, done); }
      );
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
  }, [activeFrog, history, extra, setStatus]);

  // One-shot — serialized through queue
  const generateOneShot = useCallback(async (
    prompt: OneShotPrompt,
    onToken: (t: string, done: boolean) => void
  ) => {
    if (statusRef.current !== 'ready') return;
    setStatus('interrupting');
    try {
      await oneShotQueue.enqueue(async () => {
        requestBudget.record();
        await streamFromProxy(
          { type: 'oneshot', systemPrompt: prompt.systemPrompt, userContext: prompt.userContext, ...extra },
          onToken
        );
      });
    } catch { onToken('', true); }
    finally   { setStatus('ready'); }
  }, [extra, setStatus]);

  // Image — serialized through queue
  const generateImageReaction = useCallback(async (
    prompt: ImagePrompt,
    onToken: (t: string, done: boolean) => void
  ) => {
    if (statusRef.current !== 'ready') return;
    setStatus('interrupting');
    try {
      await oneShotQueue.enqueue(async () => {
        requestBudget.record();
        await streamFromProxy(
          { type: 'image', systemPrompt: prompt.systemPrompt, userContext: prompt.userContext, imageDataUrl: prompt.imageDataUrl, ...extra },
          onToken
        );
      });
    } catch { onToken('', true); }
    finally   { setStatus('ready'); }
  }, [extra, setStatus]);

  const clearHistory = useCallback(() => {
    setHistory(activeFrog.seedHistory);
  }, [activeFrog.seedHistory]);

  const statusMessage =
    statusState === 'generating'   ? 'generating...' :
    statusState === 'interrupting' ? 'pond stirs...' :
    statusState === 'error'        ? 'pond error'    : 'ready';

  return { status: statusState, statusMessage, error, history, generate, generateOneShot, generateImageReaction, clearHistory };
}
