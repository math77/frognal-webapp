/**
 * /api/frogs
 *
 * POST — Save a custom frog. Validates input, encrypts the API key,
 *        writes to Supabase via service-role key, returns shareUrl + FrogConfig.
 *
 * GET  — Load a custom frog by UUID (for share link hydration).
 *        Returns FrogConfig WITHOUT the encrypted key (never sent to client).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin }           from '@/lib/supabaseServer';
import { encryptApiKey, decryptApiKey } from '@/lib/apiKeyCrypto';
import { buildCustomFrogConfig }       from '@/lib/customFrog';
import { FEATURES }                    from '@/lib/featureFlags';
import type { ApiProvider }            from '@/lib/supabaseServer';

// ─── Constants ────────────────────────────────────────────────────────────────

const VALID_PROVIDERS = new Set<ApiProvider>(['openai', 'anthropic']);

const VALID_MODELS = new Set([
  'gpt-4.1-nano', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o',
  'claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-6',
]);

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/i;

const BLOCKED_PATTERNS = [
  /\b(csam|child.?porn|kill yourself|self[- ]harm)\b/i,
];

function isSafe(text: string): boolean {
  return !BLOCKED_PATTERNS.some(p => p.test(text));
}

function validateApiKey(provider: ApiProvider, key: string): boolean {
  if (!key || key.length < 10) return false;
  if (provider === 'openai')    return key.startsWith('sk-');
  if (provider === 'anthropic') return key.startsWith('sk-ant-');
  return false;
}

// ─── POST /api/frogs ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  if (!FEATURES.CUSTOM_FROG_CREATOR) {
    return NextResponse.json({ error: 'Custom frogs are disabled.' }, { status: 403 });
  }

  // ── Parse body ──
  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 }); }

  const {
    creator_address, name, emoji, tagline, system_prompt,
    color, bg_color, border_color, glow_color,
    api_provider, api_key, model_id,
  } = body as Record<string, string>;

  // ── Validate ──
  if (!creator_address || !ADDRESS_RE.test(creator_address))
    return NextResponse.json({ error: 'Invalid creator address.' }, { status: 400 });

  if (!name?.trim() || name.length > 24)
    return NextResponse.json({ error: 'Name must be 1–24 characters.' }, { status: 400 });

  if (!emoji?.trim())
    return NextResponse.json({ error: 'Emoji is required.' }, { status: 400 });

  if (!tagline?.trim() || tagline.length > 80)
    return NextResponse.json({ error: 'Tagline must be 1–80 characters.' }, { status: 400 });

  if (!system_prompt?.trim() || system_prompt.length < 20 || system_prompt.length > 2000)
    return NextResponse.json({ error: 'System prompt must be 20–2000 characters.' }, { status: 400 });

  if (!color || !bg_color || !border_color || !glow_color)
    return NextResponse.json({ error: 'Color fields are required.' }, { status: 400 });

  if (!VALID_PROVIDERS.has(api_provider as ApiProvider))
    return NextResponse.json({ error: 'api_provider must be "openai" or "anthropic".' }, { status: 400 });

  if (!VALID_MODELS.has(model_id))
    return NextResponse.json({ error: 'Invalid model_id.' }, { status: 400 });

  if (!validateApiKey(api_provider as ApiProvider, api_key))
    return NextResponse.json({ error: `Invalid ${api_provider} API key format.` }, { status: 400 });

  if (!isSafe(system_prompt) || !isSafe(name) || !isSafe(tagline))
    return NextResponse.json({ error: 'Content policy violation.' }, { status: 400 });

  // ── Encrypt key + write to DB ──
  let api_key_enc: string;
  try { api_key_enc = encryptApiKey(api_key); }
  catch (err) {
    console.error('[POST /api/frogs] encryption error:', err);
    return NextResponse.json({ error: 'Server configuration error.' }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('custom_frogs')
    .insert({
      creator_address: creator_address.toLowerCase(),
      name:            name.trim(),
      emoji:           emoji.trim(),
      tagline:         tagline.trim(),
      system_prompt:   system_prompt.trim(),
      color, bg_color, border_color, glow_color,
      api_provider,
      api_key_enc,
      model_id,
    })
    .select('id, created_at, creator_address, name, emoji, tagline, system_prompt, color, bg_color, border_color, glow_color, api_provider, model_id')
    .single();

  if (error || !data) {
    console.error('[POST /api/frogs] db error:', error);
    return NextResponse.json({ error: 'Database error.' }, { status: 500 });
  }

  const origin   = req.headers.get('origin') ?? 'https://frognal.vercel.app';
  const shareUrl = `${origin}?frog=${data.id}`;
  const frog     = buildCustomFrogConfig(data as any);

  return NextResponse.json({ id: data.id, shareUrl, frog });
}

// ─── GET /api/frogs?id=<uuid> ─────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!FEATURES.CUSTOM_FROG_CREATOR) {
    return NextResponse.json({ error: 'Custom frogs are disabled.' }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const id      = req.nextUrl.searchParams.get('id')?.trim();
  const address = req.nextUrl.searchParams.get('address')?.trim().toLowerCase();

  // GET by ID — single frog for share link
  if (id) {
    const { data, error } = await supabase
      .from('custom_frogs')
      .select('id, created_at, creator_address, name, emoji, tagline, system_prompt, color, bg_color, border_color, glow_color, api_provider, model_id')
      .eq('id', id)
      .single();

    if (error || !data) return NextResponse.json({ error: 'Frog not found.' }, { status: 404 });
    return NextResponse.json({ frog: buildCustomFrogConfig(data as any) });
  }

  // GET by creator address — all frogs the wallet created
  if (address) {
    if (!/^0x[a-f0-9]{40}$/.test(address)) {
      return NextResponse.json({ error: 'Invalid address.' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('custom_frogs')
      .select('id, created_at, creator_address, name, emoji, tagline, system_prompt, color, bg_color, border_color, glow_color, api_provider, model_id')
      .eq('creator_address', address)
      .order('created_at', { ascending: true });

    if (error) return NextResponse.json({ error: 'Database error.' }, { status: 500 });
    return NextResponse.json({ frogs: (data ?? []).map(r => buildCustomFrogConfig(r as any)) });
  }

  return NextResponse.json({ error: 'Provide ?id= or ?address= param.' }, { status: 400 });
}