/**
 * /api/generate — Gemini 2.5 Flash proxy
 *
 * Keeps the API key server-side. Accepts three request types:
 *   chat    — multi-turn conversation with history
 *   oneshot — single message, no history (interruptions, silence, poke, debate)
 *   image   — multimodal single message with inline image data
 *
 * Streams back Server-Sent Events:
 *   data: {"text": "..."}\n\n   — token chunk
 *   data: [DONE]\n\n            — stream finished
 *   data: {"error": "..."}\n\n  — error during streaming
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest } from 'next/server';

const MODEL_ID = 'gemini-2.5-flash';

// Max output tokens per generation type
const MAX_TOKENS_CHAT    = 512;
const MAX_TOKENS_ONESHOT = 200;

type RequestBody = {
  type: 'chat';
  systemPrompt: string;
  history: { role: string; content: string }[];
  userMessage: string;
  topK?: number;
} | {
  type: 'oneshot';
  systemPrompt: string;
  userContext: string;
} | {
  type: 'image';
  systemPrompt: string;
  userContext: string;
  imageDataUrl: string;
};

export async function POST(req: NextRequest) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: 'GEMINI_API_KEY is not set on the server.' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const genAI = new GoogleGenerativeAI(apiKey);

  try {
    let resultStream: AsyncIterable<{ text(): string }>;

    if (body.type === 'chat') {
      const model = genAI.getGenerativeModel({
        model: MODEL_ID,
        systemInstruction: body.systemPrompt,
        generationConfig: {
          temperature: 1.0,
          topK: body.topK ?? 40,
          maxOutputTokens: MAX_TOKENS_CHAT,
        },
      });

      const chat = model.startChat({
        history: (body.history ?? []).map((m) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
      });

      const result = await chat.sendMessageStream(body.userMessage);
      resultStream = result.stream;

    } else if (body.type === 'oneshot') {
      const model = genAI.getGenerativeModel({
        model: MODEL_ID,
        systemInstruction: body.systemPrompt,
        generationConfig: {
          temperature: 1.0,
          topK: 40,
          maxOutputTokens: MAX_TOKENS_ONESHOT,
        },
      });

      const result = await model.generateContentStream(body.userContext);
      resultStream = result.stream;

    } else if (body.type === 'image') {
      const model = genAI.getGenerativeModel({
        model: MODEL_ID,
        systemInstruction: body.systemPrompt,
        generationConfig: {
          temperature: 1.0,
          topK: 40,
          maxOutputTokens: MAX_TOKENS_ONESHOT,
        },
      });

      const base64Data = body.imageDataUrl.split(',')[1] ?? '';
      const mimeType = (body.imageDataUrl.match(/data:([^;]+);/) ?? [])[1] ?? 'image/jpeg';

      const result = await model.generateContentStream([
        body.userContext,
        { inlineData: { data: base64Data, mimeType } },
      ]);
      resultStream = result.stream;

    } else {
      return new Response(
        JSON.stringify({ error: 'Unknown request type.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of resultStream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ text })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`)
          );
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      },
    });

  } catch (err) {
    // Error before streaming started (e.g. invalid API key, bad request)
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes('429') ? 429 : 500;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: { 'Content-Type': 'application/json' } }
    );
  }
}