/**
 * supabaseServer.ts — Supabase admin client for API routes.
 * Uses the service role key to bypass RLS. SERVER-SIDE ONLY.
 * Never import this in 'use client' files.
 *
 * Required env vars:
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 *
 * ─── SQL Migration ────────────────────────────────────────────────────────────
 * Run this once in Supabase SQL Editor (Dashboard → SQL Editor → New query):
 *
 * create table public.custom_frogs (
 *   id              uuid        default gen_random_uuid() primary key,
 *   created_at      timestamptz default now(),
 *   creator_address text        not null,
 *   name            text        not null check (char_length(name) <= 24),
 *   emoji           text        not null,
 *   tagline         text        not null check (char_length(tagline) <= 80),
 *   system_prompt   text        not null check (char_length(system_prompt) <= 2000),
 *   color           text        not null,
 *   bg_color        text        not null,
 *   border_color    text        not null,
 *   glow_color      text        not null,
 *   api_provider    text        not null check (api_provider in ('openai', 'anthropic')),
 *   api_key_enc     text        not null,
 *   model_id        text        not null
 * );
 *
 * alter table public.custom_frogs enable row level security;
 *
 * -- Anyone with a share link can read
 * create policy "public read"
 *   on public.custom_frogs for select using (true);
 */

import { createClient } from '@supabase/supabase-js';

export type ApiProvider = 'openai' | 'anthropic';

export interface CustomFrogRow {
  id:              string;
  created_at:      string;
  creator_address: string;
  name:            string;
  emoji:           string;
  tagline:         string;
  system_prompt:   string;
  color:           string;
  bg_color:        string;
  border_color:    string;
  glow_color:      string;
  api_provider:    ApiProvider;
  api_key_enc:     string;
  model_id:        string;
}

export function getSupabaseAdmin() {
  const url     = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const roleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !roleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
  return createClient(url, roleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
