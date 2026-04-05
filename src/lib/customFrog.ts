/**
 * customFrog.ts
 * Color presets, model options, and the factory that turns a DB row
 * into a FrogConfig the pond can use without touching frogs.ts.
 */

import type { FrogConfig, FrogId, TypingProfile, VibeConfig } from './frogs';
import type { CustomFrogRow, ApiProvider } from './supabaseServer';

// ─── Color presets ────────────────────────────────────────────────────────────

export const COLOR_PRESETS = [
  { id: 'acid',    label: 'Acid Green', color: '#39ff14', glowColor: 'rgba(57,255,20,0.45)',    bgColor: 'rgba(57,255,20,0.07)',    borderColor: 'rgba(57,255,20,0.28)'    },
  { id: 'violet',  label: 'Violet',     color: '#a78bfa', glowColor: 'rgba(167,139,250,0.45)', bgColor: 'rgba(167,139,250,0.07)', borderColor: 'rgba(167,139,250,0.28)' },
  { id: 'gold',    label: 'Gold',       color: '#fbbf24', glowColor: 'rgba(251,191,36,0.45)',  bgColor: 'rgba(251,191,36,0.07)',  borderColor: 'rgba(251,191,36,0.28)'  },
  { id: 'cyan',    label: 'Cyan',       color: '#22d3ee', glowColor: 'rgba(34,211,238,0.45)',  bgColor: 'rgba(34,211,238,0.07)',  borderColor: 'rgba(34,211,238,0.28)'  },
  { id: 'orange',  label: 'Orange',     color: '#f97316', glowColor: 'rgba(249,115,22,0.45)',  bgColor: 'rgba(249,115,22,0.07)',  borderColor: 'rgba(249,115,22,0.28)'  },
  { id: 'cream',   label: 'Cream',      color: '#e9d5a1', glowColor: 'rgba(233,213,161,0.45)', bgColor: 'rgba(233,213,161,0.07)', borderColor: 'rgba(233,213,161,0.28)' },
  { id: 'sage',    label: 'Sage',       color: '#86efac', glowColor: 'rgba(134,239,172,0.45)', bgColor: 'rgba(134,239,172,0.07)', borderColor: 'rgba(134,239,172,0.28)' },
  { id: 'rose',    label: 'Rose',       color: '#fb7185', glowColor: 'rgba(251,113,133,0.45)', bgColor: 'rgba(251,113,133,0.07)', borderColor: 'rgba(251,113,133,0.28)' },
] as const;

export type ColorPreset = typeof COLOR_PRESETS[number];

// ─── Model options ────────────────────────────────────────────────────────────

export const MODEL_OPTIONS: {
  provider: ApiProvider;
  label:    string;
  modelId:  string;
  note:     string;
}[] = [
  // OpenAI
  { provider: 'openai',    label: 'GPT-4.1 Nano',      modelId: 'gpt-4.1-nano',              note: 'fastest · cheapest'  },
  { provider: 'openai',    label: 'GPT-4.1 Mini',      modelId: 'gpt-4.1-mini',              note: 'fast · cheap'        },
  { provider: 'openai',    label: 'GPT-4.1',           modelId: 'gpt-4.1',                   note: 'smart · coding'      },
  { provider: 'openai',    label: 'GPT-4o Mini',       modelId: 'gpt-4o-mini',               note: 'multimodal · cheap'  },
  { provider: 'openai',    label: 'GPT-4o',            modelId: 'gpt-4o',                    note: 'multimodal · smart'  },
  // Anthropic
  { provider: 'anthropic', label: 'Claude Haiku 4.5',  modelId: 'claude-haiku-4-5-20251001', note: 'fastest · cheapest'  },
  { provider: 'anthropic', label: 'Claude Sonnet 4.6', modelId: 'claude-sonnet-4-6',         note: 'balanced'            },
  { provider: 'anthropic', label: 'Claude Opus 4.6',   modelId: 'claude-opus-4-6',           note: 'most capable'        },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildVibe(bgColor: string, borderColor: string, glowColor: string): VibeConfig {
  return {
    ambientGradient: `radial-gradient(ellipse 65% 50% at 50% 58%, ${bgColor.replace('0.07','0.10')} 0%, transparent 70%)`,
    bubbleGradient:  `radial-gradient(circle at 30% 30%, ${bgColor.replace('0.07','0.20')}, ${bgColor.replace('0.07','0.03')})`,
    bubbleBorder:    borderColor.replace('0.28','0.14'),
    scanlineOpacity: 0.15,
    grainOpacity:    0.04,
    bubbleSpeed:     'normal',
  };
}

const DEFAULT_TYPING: TypingProfile = { msPerTick: 42, charsPerTick: 4, variance: 0.18 };

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Converts a Supabase row (minus the encrypted key) into a FrogConfig.
 * The DB UUID is embedded in the id as `custom_<uuid>` so the
 * generate route can extract it without extra state.
 */
export function buildCustomFrogConfig(row: Omit<CustomFrogRow, 'api_key_enc'>): FrogConfig {
  return {
    id:              `custom_${row.id}` as FrogId,
    name:            row.name,
    emoji:           row.emoji,
    tagline:         row.tagline,
    color:           row.color,
    glowColor:       row.glow_color,
    bgColor:         row.bg_color,
    borderColor:     row.border_color,
    topK:            40,
    splashLine:      `${row.emoji} ${row.name} enters the pond.`,
    systemPrompt:    row.system_prompt,
    seedHistory:     [],
    interruptWeight: 4,
    typingProfile:   DEFAULT_TYPING,
    rareEvents:      [],
    vibe:            buildVibe(row.bg_color, row.border_color, row.glow_color),
  };
}

/** Extracts the raw Supabase UUID from a custom frog FrogId. */
export function extractDbId(frogId: string): string | null {
  return frogId.startsWith('custom_') ? frogId.slice('custom_'.length) : null;
}

/** $FROGNAL token address on Base mainnet */
export const FROGNAL_TOKEN_ADDRESS = '0xBCbcC5b3F80E075f10215726d1fb315675B8eD9C' as const;

/** 50 000 tokens with 18 decimals */
export const FROGNAL_THRESHOLD = BigInt(50_000) * 10n ** 18n;
