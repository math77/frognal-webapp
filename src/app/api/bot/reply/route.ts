/**
 * /api/bot/reply — Neynar webhook handler for @frognal mentions.
 *
 * Required env vars:
 *   NEYNAR_API_KEY, NEYNAR_BOT_SIGNER_UUID, NEYNAR_WEBHOOK_SECRET
 *   GEMINI_API_KEY, NEXT_PUBLIC_BOT_FID
 *
 * ─── SQL Migration ────────────────────────────────────────────────────────────
 * create table public.bot_replies (
 *   id              uuid        default gen_random_uuid() primary key,
 *   created_at      timestamptz default now(),
 *   cast_hash       text        not null,
 *   requester_fid   bigint      not null,
 *   frog_id         text        not null,
 *   reply_hash      text,
 *   unique (cast_hash, requester_fid)
 * );
 * alter table public.bot_replies enable row level security;
 */

import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { GoogleGenAI, ThinkingLevel }      from '@google/genai';
import { getSupabaseAdmin } from '@/lib/supabaseServer';
import { selectFrogForCast } from '@/lib/frogSelector';
import { FROGS }            from '@/lib/frogs';
import type { FrogId }      from '@/lib/frogs';

// ─── Config ───────────────────────────────────────────────────────────────────

const NEYNAR_API_BASE  = 'https://api.neynar.com/v2';
const MAX_REPLY_TOKENS = 300;
const MAX_CAST_CHARS   = 320;

// ─── Per-frog already-replied messages ───────────────────────────────────────

const ALREADY_REPLIED: Record<FrogId, string> = {
  shitposter:  'bestie you already got your answer, ratio yourself for asking twice fr fr 💀',
  doomer:      '...you already asked. i already answered. entropy does not reverse on request.',
  philosopher: 'The question was already posed. The answer already given. What does it mean that you return? Sit with that.',
  corporate:   'Great re-engagement, but we already circled back on this touchpoint. Let\'s not boil the ocean twice.',
  politician:  'I already addressed this — THOROUGHLY — and frankly the fact you\'re asking again tells me everything about the OPPOSITION\'s tactics.',
  aristocrat:  'One does not repeat oneself. I said what I said. Do try to keep up.',
  sincerity:   'oh, I already replied to you on this one. I\'m still here if you want to talk somewhere new though.',
};

// ─── Per-frog generation error messages ──────────────────────────────────────

const ERROR_MESSAGES: Record<FrogId, string> = {
  shitposter:  'bro the frog absolutely bricked it ngl, pond is cooked rn 💀 try again later',
  doomer:      '...even the infrastructure has given up. this is somehow appropriate.',
  philosopher: 'The pond attempted to speak. Something prevented it. Perhaps the silence was the answer.',
  corporate:   'We\'re experiencing unplanned downtime in our response pipeline. Looping in the team to action a fix ASAP.',
  politician:  'The MAINSTREAM pond servers are INTERFERING with my message — this is EXACTLY what I warned about.',
  aristocrat:  'Something has malfunctioned. I find I cannot summon the energy to be surprised.',
  sincerity:   'something went wrong on my end and I\'m really sorry. please try again, I do want to reply.',
};

// ─── Frog signature prefix ────────────────────────────────────────────────────
// Prepended to every reply so the user knows which frog answered.

function sig(frogId: FrogId): string {
  const f = FROGS[frogId];
  return `${f.emoji} ${f.name}:\n`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function verifyNeynarSignature(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret    = process.env.NEYNAR_WEBHOOK_SECRET;
  const signature = req.headers.get('x-neynar-signature');
  if (!secret || !signature) return false;
  const expected = createHmac('sha512', secret).update(rawBody).digest('hex');
  try { return timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex')); }
  catch { return false; }
}

async function getPreviousReply(castHash: string, fid: number): Promise<{ frogId: FrogId } | null> {
  const { data } = await getSupabaseAdmin()
    .from('bot_replies').select('frog_id')
    .eq('cast_hash', castHash).eq('requester_fid', fid).single();
  return data ? { frogId: data.frog_id as FrogId } : null;
}

async function saveReply(castHash: string, fid: number, frogId: string, replyHash?: string) {
  await getSupabaseAdmin().from('bot_replies')
    .insert({ cast_hash: castHash, requester_fid: fid, frog_id: frogId, reply_hash: replyHash ?? null })
    .throwOnError();
}

async function generate(frogId: FrogId, castText: string, username: string): Promise<string> {
  const frog = FROGS[frogId];
  const ai   = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const prompt =
    `Someone on Farcaster (@${username}) posted:\n"${castText.trim()}"\n\n` +
    `Reply in 1–2 sentences MAX. Stay completely in character. Be reactive and punchy. ` +
    `No hashtags. Do not start with "@${username}". Do not introduce yourself.`;

  const res = await ai.models.generateContent({
    model: 'gemma-4-26b-a4b-it',
    config: {
      thinkingConfig:    { thinkingLevel: ThinkingLevel.MINIMAL },
      systemInstruction: frog.systemPrompt,
      maxOutputTokens:   MAX_REPLY_TOKENS,
      temperature:       1.0,
      topK:              40,
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  const text    = res.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
  const full    = sig(frogId) + text;
  if (full.length <= MAX_CAST_CHARS) return full;
  const cut = full.slice(0, MAX_CAST_CHARS - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).trim();
}

async function postCast(text: string, parentHash: string, parentFid: number): Promise<string | null> {
  const res = await fetch(`${NEYNAR_API_BASE}/farcaster/cast`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': process.env.NEYNAR_API_KEY! },
    body: JSON.stringify({
      signer_uuid:       process.env.NEYNAR_BOT_SIGNER_UUID!,
      text,
      parent:            parentHash,
      parent_author_fid: parentFid,
    }),
  });
  if (!res.ok) {
    console.error('[bot/reply] Neynar error:', await res.text().catch(() => res.status));
    return null;
  }
  return (await res.json())?.cast?.hash ?? null;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!await verifyNeynarSignature(req, rawBody))
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 401 });

  let payload: any;
  try { payload = JSON.parse(rawBody); }
  catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  if (payload?.type !== 'cast.created')
    return NextResponse.json({ ok: true, skipped: 'not a cast event' });

  const cast      = payload?.data;
  const hash      = cast?.hash             as string | undefined;
  const text      = cast?.text             as string | undefined;
  const authorFid = cast?.author?.fid      as number | undefined;
  const username  = cast?.author?.username as string | undefined;

  if (!hash || !text || !authorFid)
    return NextResponse.json({ ok: true, skipped: 'missing fields' });

  const botFid = Number(process.env.NEXT_PUBLIC_BOT_FID);
  if (botFid && authorFid === botFid)
    return NextResponse.json({ ok: true, skipped: 'self-mention' });

  // ── Already replied — send in-character brush-off ──
  const previous = await getPreviousReply(hash, authorFid);
  if (previous) {
    const frogId  = previous.frogId;
    await postCast(sig(frogId) + ALREADY_REPLIED[frogId], hash, authorFid);
    return NextResponse.json({ ok: true, skipped: 'already replied', frogId });
  }

  // ── Pick frog + generate ──
  const frogId = selectFrogForCast(text);

  let replyText: string;
  try {
    replyText = await generate(frogId, text, username ?? 'friend');
  } catch (err) {
    console.error('[bot/reply] generation error:', err);
    await postCast(sig(frogId) + ERROR_MESSAGES[frogId], hash, authorFid);
    await saveReply(hash, authorFid, frogId).catch(() => {});
    return NextResponse.json({ error: 'Generation failed.', frogId }, { status: 500 });
  }

  const replyHash = await postCast(replyText, hash, authorFid);
  await saveReply(hash, authorFid, frogId, replyHash ?? undefined).catch(err => {
    console.error('[bot/reply] save failed:', err);
  });

  return NextResponse.json({ ok: true, frogId, replyHash });
}