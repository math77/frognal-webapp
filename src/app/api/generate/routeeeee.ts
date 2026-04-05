/**
 * /api/generate — unified LLM proxy
 *
 * Default: Gemini 2.5 Flash (free tier, our key)
 * Custom frogs: OpenAI or Anthropic using the creator's encrypted key from DB
 *
 * All providers stream the same SSE format:
 *   data: {"text":"..."}\n\n   — token chunk
 *   data: [DONE]\n\n           — stream finished
 *   data: {"error":"..."}\n\n  — error
 *
 * Request body fields:
 *   type           — 'chat' | 'oneshot' | 'image'
 *   customFrogId   — optional; if present, look up provider + key from DB
 *   (rest same as before)
 */

import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { getSupabaseAdmin }   from '@/lib/supabaseServer';
import { decryptApiKey }      from '@/lib/apiKeyCrypto';
import { extractDbId }        from '@/lib/customFrog';
import type { ApiProvider }   from '@/lib/supabaseServer';

import { GoogleGenAI, ThinkingLevel } from '@google/genai';

// ─── Token limits ─────────────────────────────────────────────────────────────

const MAX_CHAT    = 512;
const MAX_ONESHOT = 600;
//'gemini-2.5-flash';
const MODEL_ID = 'gemma-4-26b-a4b-it';

// ─── SSE helpers ─────────────────────────────────────────────────────────────

const enc = new TextEncoder();

function sseChunk(text: string) {
  return enc.encode(`data: ${JSON.stringify({ text })}\n\n`);
}
function sseDone() {
  return enc.encode('data: [DONE]\n\n');
}
function sseError(msg: string) {
  return enc.encode(`data: ${JSON.stringify({ error: msg })}\n\n`);
}

function sseResponse(
  gen: (ctrl: ReadableStreamDefaultController) => Promise<void>
): Response {
  const stream = new ReadableStream({
    async start(ctrl) {
      try   { await gen(ctrl); }
      catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        ctrl.enqueue(sseError(msg));
      } finally {
        ctrl.enqueue(sseDone());
        ctrl.close();
      }
    },
  });
  return new Response(stream, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' },
  });
}

// ─── Custom frog DB lookup ────────────────────────────────────────────────────

interface FrogCreds { provider: ApiProvider; apiKey: string; modelId: string; }

async function getFrogCreds(customFrogId: string): Promise<FrogCreds | null> {
  const dbId = extractDbId(customFrogId);
  if (!dbId) return null;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('custom_frogs')
    .select('api_provider, api_key_enc, model_id')
    .eq('id', dbId)
    .single();

  if (error || !data) return null;

  try {
    const apiKey = decryptApiKey(data.api_key_enc);
    return { provider: data.api_provider as ApiProvider, apiKey, modelId: data.model_id };
  } catch {
    return null;
  }
}

// ─── Provider generators ──────────────────────────────────────────────────────
/*
// Gemini (default)
async function* geminiStream(
  body: Record<string, unknown>
): AsyncGenerator<string> {
  const apiKey = process.env.GEMINI_API_KEY!;
  const genAI  = new GoogleGenerativeAI(apiKey);
  const type   = body.type as string;

  if (type === 'chat') {
    const model = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: body.systemPrompt as string,
      generationConfig:  { 
        temperature: 1.0, 
        topK: (body.topK as number) ?? 40, 
        maxOutputTokens: MAX_CHAT,
        // @ts-expect-error — thinkingConfig not yet in all SDK type defs
        thinkingConfig: { thinkingBudget: 0 }, 
      },
    });
    const chat = model.startChat({
      history: ((body.history as any[]) ?? []).map(m => ({
        role:  m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content as string }],
      })),
    });
    const result = await chat.sendMessageStream(body.userMessage as string);
    for await (const chunk of result.stream) { yield chunk.text(); }

  } else if (type === 'oneshot') {
    const model  = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: body.systemPrompt as string,
      generationConfig:  { 
        temperature: 1.0, topK: 40, 
        maxOutputTokens: MAX_ONESHOT,
        // @ts-expect-error — thinkingConfig not yet in all SDK type defs
        thinkingConfig: { thinkingBudget: 0 },  
      },
    });
    const result = await model.generateContentStream(body.userContext as string);
    for await (const chunk of result.stream) { yield chunk.text(); }

  } else if (type === 'image') {
    const model  = genAI.getGenerativeModel({
      model: DEFAULT_MODEL,
      systemInstruction: body.systemPrompt as string,
      generationConfig:  { 
        temperature: 1.0, 
        topK: 40, 
        maxOutputTokens: MAX_ONESHOT,
        // @ts-expect-error — thinkingConfig not yet in all SDK type defs
        thinkingConfig: { thinkingBudget: 0 },  
      },
    });
    const base64  = (body.imageDataUrl as string).split(',')[1] ?? '';
    const mime    = ((body.imageDataUrl as string).match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    const result  = await model.generateContentStream([body.userContext as string, { inlineData: { data: base64, mimeType: mime } }]);
    for await (const chunk of result.stream) { yield chunk.text(); }
  }
}*/


// Replace the geminiStream function with:
async function* geminiStream(body: Record<string, unknown>): AsyncGenerator<string> {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
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
      ...((body.history as any[]) ?? []).map((m: any) => ({
        role: m.role === 'model' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: body.userMessage as string }] },
    ];
  } else if (type === 'oneshot') {
    contents = [{ role: 'user', parts: [{ text: body.userContext as string }] }];
  } else { // image
    const base64 = (body.imageDataUrl as string).split(',')[1] ?? '';
    const mime = ((body.imageDataUrl as string).match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    contents = [{ role: 'user', parts: [{ text: body.userContext as string }, { inlineData: { data: base64, mimeType: mime } }] }];
  }

  const response = await ai.models.generateContentStream({
    model: MODEL_ID,
    config,
    contents,
  });

  for await (const chunk of response) {
    if (chunk.text) yield chunk.text;
  }
}


// OpenAI
async function* openaiStream(
  body: Record<string, unknown>, creds: FrogCreds
): AsyncGenerator<string> {
  const client   = new OpenAI({ apiKey: creds.apiKey });
  const type     = body.type as string;
  const maxTok   = type === 'chat' ? MAX_CHAT : MAX_ONESHOT;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: body.systemPrompt as string },
  ];

  if (type === 'chat') {
    for (const m of (body.history as any[]) ?? []) {
      messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content });
    }
    messages.push({ role: 'user', content: body.userMessage as string });

  } else if (type === 'oneshot') {
    messages.push({ role: 'user', content: body.userContext as string });

  } else if (type === 'image') {
    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: body.userContext as string },
        { type: 'image_url', image_url: { url: body.imageDataUrl as string } },
      ],
    });
  }

  const stream = await client.chat.completions.create({
    model: creds.modelId, messages, stream: true,
    max_tokens: maxTok, temperature: 1.0,
  });

  for await (const chunk of stream) {
    yield chunk.choices[0]?.delta?.content ?? '';
  }
}

// Anthropic
async function* anthropicStream(
  body: Record<string, unknown>, creds: FrogCreds
): AsyncGenerator<string> {
  const client  = new Anthropic({ apiKey: creds.apiKey });
  const type    = body.type as string;
  const maxTok  = type === 'chat' ? MAX_CHAT : MAX_ONESHOT;

  const messages: Anthropic.MessageParam[] = [];

  if (type === 'chat') {
    for (const m of (body.history as any[]) ?? []) {
      messages.push({ role: m.role === 'model' ? 'assistant' : 'user', content: m.content });
    }
    messages.push({ role: 'user', content: body.userMessage as string });

  } else if (type === 'oneshot') {
    messages.push({ role: 'user', content: body.userContext as string });

  } else if (type === 'image') {
    const dataUrl = body.imageDataUrl as string;
    const base64  = dataUrl.split(',')[1] ?? '';
    const mime    = (dataUrl.match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';
    messages.push({
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mime as any, data: base64 } },
        { type: 'text', text: body.userContext as string },
      ],
    });
  }

  const stream = await client.messages.stream({
    model: creds.modelId, system: body.systemPrompt as string,
    messages, max_tokens: maxTok,
  });

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not set.' }), { status: 500 });
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return new Response(JSON.stringify({ error: 'Invalid JSON.' }), { status: 400 }); }

  const customFrogId = body.customFrogId as string | undefined;

  // Determine provider
  let creds: FrogCreds | null = null;
  if (customFrogId) {
    creds = await getFrogCreds(customFrogId);
    if (!creds) {
      return new Response(JSON.stringify({ error: 'Custom frog not found or key decryption failed.' }), { status: 404 });
    }
  }

  // Stream
  return sseResponse(async (ctrl) => {
    let gen: AsyncGenerator<string>;

    if (!creds) {
      gen = geminiStream(body);
    } else if (creds.provider === 'openai') {
      gen = openaiStream(body, creds);
    } else {
      gen = anthropicStream(body, creds);
    }

    for await (const text of gen) {
      if (text) ctrl.enqueue(sseChunk(text));
    }
  });
}