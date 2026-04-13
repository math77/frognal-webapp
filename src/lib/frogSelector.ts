/**
 * frogSelector.ts
 * Picks the most contextually appropriate frog to reply to a Farcaster cast.
 *
 * Strategy: keyword matching first (deterministic + fast), then weighted
 * random fallback so every frog gets airtime even on neutral casts.
 */

import type { FrogId } from './frogs';

// Only the 6 default frogs — custom frogs are not used by the bot
export const BOT_FROG_IDS: FrogId[] = [
  'shitposter', 'doomer', 'philosopher', 'corporate', 'politician', 'aristocrat',
];

// ─── Keyword rules ────────────────────────────────────────────────────────────
// Order matters — first match wins.

const RULES: { patterns: RegExp[]; frogId: FrogId }[] = [
  {
    frogId: 'corporate',
    patterns: [/\b(money|profit|revenue|funding|invest|startup|hustle|grind|salary|raise|vc|valuation|build|founder|ship|product|launch|growth|saas|web3|onchain|token|nft|defi)\b/i],
  },
  {
    frogId: 'politician',
    patterns: [/\b(government|vote|election|political|policy|corrupt|freedom|rights|law|protest|taxes|democracy|president|regulation|banned|censored|narrative)\b/i],
  },
  {
    frogId: 'doomer',
    patterns: [/\b(die|death|dying|dead|hopeless|pointless|futile|doom|collapse|extinction|depressed|sad|lonely|broken|failed|over|end|nothing matters)\b/i],
  },
  {
    frogId: 'philosopher',
    patterns: [/\b(why|meaning|purpose|exist|consciousness|reality|truth|soul|free will|god|universe|time|identity|self|mind|awareness|wisdom)\b/i],
  },
  {
    frogId: 'aristocrat',
    patterns: [/\b(class|luxury|estate|rich|wealth|taste|refinement|culture|art|wine|elite|quality|inferior|standards|breeding|old money)\b/i],
  },
  {
    frogId: 'shitposter',
    patterns: [/\b(lmao|lol|cringe|ratio|based|cope|seethe|mid|npc|meme|vibe|fr|ngl|lowkey|highkey|bruh|no cap|bussin|built different|cooked|gg)\b/i],
  },
];

// ─── Weighted fallback ────────────────────────────────────────────────────────
// Shitposter and politician get higher weight since they fit most social content.

const FALLBACK_WEIGHTS: Record<FrogId, number> = {
  shitposter:  5,
  doomer:      2,
  philosopher: 3,
  corporate:   3,
  politician:  4,
  aristocrat:  3,
  sincerity: 1
};

function weightedRandom(): FrogId {
  const entries = BOT_FROG_IDS.map(id => ({ id, weight: FALLBACK_WEIGHTS[id] }));
  const total   = entries.reduce((s, e) => s + e.weight, 0);
  let roll      = Math.random() * total;
  for (const entry of entries) {
    roll -= entry.weight;
    if (roll <= 0) return entry.id;
  }
  return 'shitposter';
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Picks the frog whose personality best matches the cast content.
 * Falls back to weighted random when no keyword rule matches.
 */
export function selectFrogForCast(castText: string): FrogId {
  for (const rule of RULES) {
    if (rule.patterns.some(p => p.test(castText))) {
      return rule.frogId;
    }
  }
  return weightedRandom();
}