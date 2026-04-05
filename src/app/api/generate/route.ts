/**
 * /api/generate — unified LLM proxy with server-side rate limiting.
 */

import { NextRequest } from 'next/server';
import { GoogleGenAI, ThinkingLevel }     from '@google/genai';
import OpenAI              from 'openai';
import Anthropic           from '@anthropic-ai/sdk';
import { getSupabaseAdmin }  from '@/lib/supabaseServer';
import { decryptApiKey }     from '@/lib/apiKeyCrypto';
import { extractDbId }       from '@/lib/customFrog';
import { isRateLimited, retryAfterSeconds } from '@/lib/rateLimiter';
import type { ApiProvider }  from '@/lib/supabaseServer';

const MODEL_ID    = 'gemma-4-26b-a4b-it';
const MAX_CHAT    = 512;
const MAX_ONESHOT = 400;

const enc = new TextEncoder();
const sseChunk = (text: string) => enc.encode(`data: ${JSON.stringify({ text })}\n\n`);
const sseDone  = ()              => enc.encode('data: [DONE]\n\n');
const sseError = (msg: string)   => enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`);

function sseResponse(gen: (ctrl: ReadableStreamDefaultController) => Promise<void>): Response {
  const stream = new ReadableStream({
    async start(ctrl) {
      try   { await gen(ctrl); }
      catch (err) {
        ctrl.enqueue(sseError(err instanceof Error ? err.message : String(err)));
      } finally {
        ctrl.enqueue(sseDone());
        ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
  });
}

interface FrogCreds { provider: ApiProvider; apiKey: string; modelId: string; }

async function getFrogCreds(id: string): Promise<FrogCreds | null> {
  const dbId = extractDbId(id);
  if (!dbId) return null;
  const { data, error } = await getSupabaseAdmin()
    .from('custom_frogs').select('api_provider, api_key_enc, model_id').eq('id', dbId).single();
  if (error || !data) return null;
  try { return { provider: data.api_provider as ApiProvider, apiKey: decryptApiKey(data.api_key_enc), modelId: data.model_id }; }
  catch { return null; }
}

async function* geminiStream(body: Record<string, unknown>): AsyncGenerator<string> {
  const ai   = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const type = body.type as string;
  const config = {
    thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
    systemInstruction: body.systemPrompt as string,
    maxOutputTokens: type === 'chat' ? MAX_CHAT : MAX_ONESHOT,
    temperature: 1.0,
    topK: (body.topK as number) ?? 40,
  };

  let contents: any[];
  if (type === 'chat') {
    contents = [
      ...((body.history as any[]) ?? []).map((m: any) => ({ role: m.role === 'model' ? 'model' : 'user', parts: [{ text: m.content }] })),
      { role: 'user', parts: [{ text: body.userMessage as string }] },
    ];
  } else if (type === 'oneshot') {
    contents = [{ role: 'user', parts: [{ text: body.userContext as string }] }];
  } else {
    const base64 = (body.imageDataUrl as string).split(',')[1] ?? '';
    const mime   = ((body.imageDataUrl as string).match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    contents = [{ role: 'user', parts: [{ text: body.userContext as string }, { inlineData: { data: base64, mimeType: mime } }] }];
  }

  const res = await ai.models.generateContentStream({ model: MODEL_ID, config, contents });
  for await (const chunk of res) { if (chunk.text) yield chunk.text; }
}

async function* openaiStream(body: Record<string, unknown>, c: FrogCreds): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: c.apiKey });
  const type   = body.type as string;
  const msgs: OpenAI.Chat.ChatCompletionMessageParam[] = [{ role: 'system', content: body.systemPrompt as string }];
  if (type === 'chat') {
    for (const m of (body.history as any[]) ?? []) msgs.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content });
    msgs.push({ role: 'user', content: body.userMessage as string });
  } else if (type === 'oneshot') {
    msgs.push({ role: 'user', content: body.userContext as string });
  } else {
    const base64 = (body.imageDataUrl as string).split(',')[1] ?? '';
    const mime   = ((body.imageDataUrl as string).match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    msgs.push({ role: 'user', content: [{ type: 'text', text: body.userContext as string }, { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } }] });
  }
  const stream = await client.chat.completions.create({ model: c.modelId, messages: msgs, stream: true, max_tokens: type === 'chat' ? MAX_CHAT : MAX_ONESHOT, temperature: 1.0 });
  for await (const chunk of stream) { yield chunk.choices[0]?.delta?.content ?? ''; }
}

async function* anthropicStream(body: Record<string, unknown>, c: FrogCreds): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: c.apiKey });
  const type   = body.type as string;
  const msgs: Anthropic.MessageParam[] = [];
  if (type === 'chat') {
    for (const m of (body.history as any[]) ?? []) msgs.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content });
    msgs.push({ role: 'user', content: body.userMessage as string });
  } else if (type === 'oneshot') {
    msgs.push({ role: 'user', content: body.userContext as string });
  } else {
    const base64 = (body.imageDataUrl as string).split(',')[1] ?? '';
    const mime   = ((body.imageDataUrl as string).match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    msgs.push({ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mime as any, data: base64 } }, { type: 'text', text: body.userContext as string }] });
  }
  const stream = await client.messages.stream({ model: c.modelId, system: body.systemPrompt as string, messages: msgs, max_tokens: type === 'chat' ? MAX_CHAT : MAX_ONESHOT });
  for await (const ev of stream) {
    if (ev.type === 'content_block_delta' && ev.delta.type === 'text_delta') yield ev.delta.text;
  }
}

export async function POST(req: NextRequest) {
  // Server-side rate limit per IP
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? req.headers.get('x-real-ip')
    ?? 'unknown';

  if (isRateLimited(ip)) {
    const retry = retryAfterSeconds(ip);
    return new Response(
      JSON.stringify({ error: `Rate limit reached. Try again in ${retry}s.` }),
      { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': String(retry) } }
    );
  }

  if (!process.env.GEMINI_API_KEY)
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set.' }), { status: 500 });

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400 }); }

  const creds = body.customFrogId
    ? await getFrogCreds(body.customFrogId as string)
    : null;

  if (body.customFrogId && !creds)
    return new Response(JSON.stringify({ error: 'Custom frog not found.' }), { status: 404 });

  return sseResponse(async (ctrl) => {
    const gen = !creds                        ? geminiStream(body)
              : creds.provider === 'openai'   ? openaiStream(body, creds)
              :                                 anthropicStream(body, creds);
    for await (const text of gen) { if (text) ctrl.enqueue(sseChunk(text)); }
  });
}
