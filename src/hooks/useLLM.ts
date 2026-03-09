'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildGemmaPrompt, type ChatMessage } from '@/lib/gemmaPrompt';
import { type FrogConfig } from '@/lib/frogs';


const MODEL_PATH = '/assets/gemma-3n-E4B-it-int4-Web.litertlm';
const MEDIAPIPE_WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai@latest/wasm';

export type LLMStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'generating'
  | 'interrupting'
  | 'error';

/** A segment of a multimodal prompt — either plain text or an image source. */
export type PromptSegment = string | { imageSource: string };

export interface UseLLMReturn {
  status: LLMStatus;
  statusMessage: string;
  error: string | null;
  history: ChatMessage[];
  /**
   * Normal chat generation.
   * @param contextSuffix  Optional string appended to the system prompt.
   */
  generate: (
    userMessage: string,
    onToken: (token: string, done: boolean) => void,
    contextSuffix?: string
  ) => Promise<void>;
  /**
   * One-shot generation for interruptions, silence, poke.
   * Takes a pre-built raw Gemma prompt string — no history, no system injection.
   */
  generateOneShot: (
    rawPrompt: string,
    onToken: (token: string, done: boolean) => void
  ) => Promise<void>;
  /**
   * Multimodal one-shot: accepts an array of text + image segments.
   * Used for frog image reactions.
   */
  generateImageReaction: (
    promptSegments: PromptSegment[],
    onToken: (token: string, done: boolean) => void
  ) => Promise<void>;
  clearHistory: () => void;
}

export function useLLM(activeFrog: FrogConfig): UseLLMReturn {
  const [status, setStatus] = useState<LLMStatus>('idle');
  const [statusMessage, setStatusMessage] = useState('awaiting the pond...');
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<ChatMessage[]>(activeFrog.seedHistory);

  const llmRef = useRef<any>(null);
  const initializingRef = useRef(false);

  // ── Init ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const init = async () => {
      if (initializingRef.current || llmRef.current) return;
      initializingRef.current = true;

      if (typeof navigator === 'undefined' || !('gpu' in navigator) || !navigator.gpu) {
        setStatus('error');
        setError('WebGPU not supported. Use Chrome 113+ or Edge 113+ on desktop.');
        initializingRef.current = false;
        return;
      }

      try {
        setStatus('loading');
        setStatusMessage('loading mediapipe from the swamp...');
        const { FilesetResolver, LlmInference } = await import('@mediapipe/tasks-genai');

        setStatusMessage('resolving wasm fileset...');
        const genai = await FilesetResolver.forGenAiTasks(MEDIAPIPE_WASM_URL);

        setStatusMessage('loading gemma-3n E4B (15–30s on first load)...');
        llmRef.current = await LlmInference.createFromOptions(genai, {
          baseOptions: { modelAssetPath: MODEL_PATH },
          maxTokens: 2048,
          topK: 40,
          temperature: 1.0,
          randomSeed: Math.floor(Math.random() * 99999),
          maxNumImages: 1,
        });

        setStatus('ready');
        setStatusMessage('frog is awake');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[useLLM] init error:', err);
        if (msg.includes('404') || msg.includes('Failed to fetch') || msg.includes('model')) {
          setError(
            `Model not found at ${MODEL_PATH}. ` +
            `Download gemma-3n-E4B-it-int4-Web.litertlm from HuggingFace ` +
            `and place it in public/assets/. See MODEL_SETUP.md.`
          );
        } else {
          setError(`Init failed: ${msg}`);
        }
        setStatus('error');
      } finally {
        initializingRef.current = false;
      }
    };

    init();
  }, []);

  // ── generate ──────────────────────────────────────────────────────────────────

  const generate = useCallback(
    async (
      userMessage: string,
      onToken: (token: string, done: boolean) => void,
      contextSuffix?: string
    ): Promise<void> => {
      if (!llmRef.current || status !== 'ready') return;

      setStatus('generating');

      // Append pond memory context to system prompt if provided
      const effectiveSystemPrompt = contextSuffix
        ? `${activeFrog.systemPrompt}${contextSuffix}`
        : activeFrog.systemPrompt;

      const currentHistory = history;
      const prompt = buildGemmaPrompt(effectiveSystemPrompt, currentHistory, userMessage);

      return new Promise<void>((resolve, reject) => {
        let fullResponse = '';
        try {
          llmRef.current.generateResponse(
            prompt,
            (partialResult: string, done: boolean) => {
              fullResponse += partialResult;
              onToken(partialResult, done);
              if (done) {
                setHistory((prev) => [
                  ...prev,
                  { role: 'user', content: userMessage },
                  { role: 'model', content: fullResponse },
                ]);
                setStatus('ready');
                resolve();
              }
            }
          );
        } catch (err) {
          console.error('[useLLM] generate error:', err);
          setStatus('ready');
          reject(err);
        }
      });
    },
    [activeFrog.systemPrompt, history, status]
  );

  // ── generateOneShot ───────────────────────────────────────────────────────────

  const generateOneShot = useCallback(
    async (
      rawPrompt: string,
      onToken: (token: string, done: boolean) => void
    ): Promise<void> => {
      if (!llmRef.current || status !== 'ready') return;

      setStatus('interrupting');

      return new Promise<void>((resolve, reject) => {
        try {
          llmRef.current.generateResponse(
            rawPrompt,
            (partialResult: string, done: boolean) => {
              onToken(partialResult, done);
              if (done) {
                setStatus('ready');
                resolve();
              }
            }
          );
        } catch (err) {
          console.error('[useLLM] generateOneShot error:', err);
          setStatus('ready');
          reject(err);
        }
      });
    },
    [status]
  );

  // ── generateImageReaction ─────────────────────────────────────────────────────

  const generateImageReaction = useCallback(
    async (
      promptSegments: PromptSegment[],
      onToken: (token: string, done: boolean) => void
    ): Promise<void> => {
      if (!llmRef.current || status !== 'ready') return;

      setStatus('interrupting');

      return new Promise<void>((resolve, reject) => {
        try {
          llmRef.current.generateResponse(
            promptSegments,
            (partialResult: string, done: boolean) => {
              onToken(partialResult, done);
              if (done) {
                setStatus('ready');
                resolve();
              }
            }
          );
        } catch (err) {
          console.error('[useLLM] generateImageReaction error:', err);
          setStatus('ready');
          reject(err);
        }
      });
    },
    [status]
  );

  // ── clearHistory ──────────────────────────────────────────────────────────────

  const clearHistory = useCallback(() => {
    setHistory(activeFrog.seedHistory);
  }, [activeFrog.seedHistory]);

  return { status, statusMessage, error, history, generate, generateOneShot, generateImageReaction, clearHistory };
}