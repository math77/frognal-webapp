import { FROGS, type FrogConfig, type FrogId, type RareEvent } from './frogs';
import type { PondMemory } from './pondMemory';
import type { OneShotPrompt, ImagePrompt } from './promptTypes';

// ─── Config ───────────────────────────────────────────────────────────────────

const BASE_INTERRUPT_CHANCE   = 0.15;
const STREAK_BONUS_PER_MSG    = 0.05;
const MAX_INTERRUPT_CHANCE    = 0.65;
const PILE_ON_CHANCE          = 0.30;
const LAST_WORD_CHANCE        = 0.28;
const RARE_EVENT_CHANCE       = 0.02;

// ─── Easter eggs ─────────────────────────────────────────────────────────────

const EASTER_EGGS: Array<{ patterns: RegExp[]; frogId: FrogId }> = [
  { patterns: [/\b(money|profit|revenue|funding|invest|startup|hustle|grind|salary|raise|vc|valuation)\b/i], frogId: 'corporate' },
  { patterns: [/\b(why|meaning|purpose|exist|consciousness|reality|truth|soul|free will|god)\b/i],            frogId: 'philosopher' },
  { patterns: [/\b(fake|rigged|corrupt|election|government|media|lies|conspiracy|vote|freedom|deep state)\b/i], frogId: 'politician' },
  { patterns: [/\b(die|death|dying|dead|end|hopeless|pointless|futile|doom|collapse|extinction)\b/i],          frogId: 'doomer' },
  { patterns: [/\b(cringe|ratio|based|cope|seethe|mid|npc|reddit|twitter|meme|vibe)\b/i],                     frogId: 'shitposter' },
  { patterns: [/\b(poor|cheap|rich|luxury|taste|class|wine|estate|manor|butler|elite)\b/i],                   frogId: 'aristocrat' },
  { patterns: [/\b(please|thank you|i appreciate|you're wonderful|i believe|you're kind)\b/i],                 frogId: 'sincerity' },
];

export function checkEasterEgg(userMessage: string, activeFrogId: FrogId): FrogId | null {
  for (const egg of EASTER_EGGS) {
    if (egg.frogId === activeFrogId) continue;
    if (egg.patterns.some((p) => p.test(userMessage))) return egg.frogId;
  }
  return null;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InterruptionPlan {
  shouldInterrupt:    boolean;
  interruptingFrogId: FrogId | null;
  shouldPileOn:       boolean;
  pileOnFrogId:       FrogId | null;
  isEasterEgg:        boolean;
}

// ─── planInterruption ─────────────────────────────────────────────────────────

export function planInterruption(
  activeFrogId: FrogId,
  streakCount: number,
  userMessage: string,
  unlockedFrogs?: FrogId[]
): InterruptionPlan {
  const eggFrogId = checkEasterEgg(userMessage, activeFrogId);
  if (eggFrogId && (!FROGS[eggFrogId].hidden || unlockedFrogs?.includes(eggFrogId))) {
    const pileOnFrogId = Math.random() < PILE_ON_CHANCE
      ? pickWeightedFrog(activeFrogId, eggFrogId, unlockedFrogs)
      : null;
    return { shouldInterrupt: true, interruptingFrogId: eggFrogId, shouldPileOn: pileOnFrogId !== null, pileOnFrogId, isEasterEgg: true };
  }

  const chance = Math.min(BASE_INTERRUPT_CHANCE + streakCount * STREAK_BONUS_PER_MSG, MAX_INTERRUPT_CHANCE);
  if (Math.random() > chance) {
    return { shouldInterrupt: false, interruptingFrogId: null, shouldPileOn: false, pileOnFrogId: null, isEasterEgg: false };
  }

  const interruptingFrogId = pickWeightedFrog(activeFrogId, null, unlockedFrogs);
  if (!interruptingFrogId) {
    return { shouldInterrupt: false, interruptingFrogId: null, shouldPileOn: false, pileOnFrogId: null, isEasterEgg: false };
  }

  const shouldPileOn = Math.random() < PILE_ON_CHANCE;
  const pileOnFrogId = shouldPileOn ? pickWeightedFrog(activeFrogId, interruptingFrogId, unlockedFrogs) : null;

  return { shouldInterrupt: true, interruptingFrogId, shouldPileOn: shouldPileOn && pileOnFrogId !== null, pileOnFrogId, isEasterEgg: false };
}

function pickWeightedFrog(
  excludeA: FrogId,
  excludeB: FrogId | null,
  unlockedFrogs?: FrogId[]
): FrogId | null {
  const candidates = Object.values(FROGS).filter((f) => {
    if (f.id === excludeA || f.id === excludeB) return false;
    if (f.hidden && !unlockedFrogs?.includes(f.id)) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  const total = candidates.reduce((s, f) => s + f.interruptWeight, 0);
  let roll = Math.random() * total;
  for (const frog of candidates) {
    roll -= frog.interruptWeight;
    if (roll <= 0) return frog.id;
  }
  return candidates[candidates.length - 1].id;
}

// ─── Rare event checker ───────────────────────────────────────────────────────

export function checkRareEvent(frogId: FrogId, memory: PondMemory): RareEvent | null {
  if (memory.turn < 5) return null;
  const frog = FROGS[frogId];
  const availableEvents = frog.rareEvents.filter((e) => !memory.firedRareEvents.has(e.id));
  if (availableEvents.length === 0) return null;
  if (Math.random() > RARE_EVENT_CHANCE) return null;
  const event = availableEvents[Math.floor(Math.random() * availableEvents.length)];
  memory.firedRareEvents.add(event.id);
  return event;
}

// ─── Debate mode ─────────────────────────────────────────────────────────────

export const DEBATE_ROUNDS = 3;

export function checkDebateCommand(input: string): string | null {
  const match = input.match(/^\/debate\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

export function pickDebateFrogs(topic: string, unlockedFrogs: FrogId[]): [FrogId, FrogId] {
  const allFrogs: FrogId[] = [
    'shitposter', 'doomer', 'philosopher', 'corporate', 'politician', 'aristocrat',
    ...unlockedFrogs.filter((id) => FROGS[id].hidden),
  ];
  const topicLower = topic.toLowerCase();
  if (/\b(money|hustle|grind|work|success|wealth|startup)\b/.test(topicLower)) return ['corporate', 'doomer'];
  if (/\b(truth|reality|exist|meaning|life|god|consciousness)\b/.test(topicLower)) return ['philosopher', 'politician'];
  if (/\b(class|elite|rich|poor|taste|luxury|society)\b/.test(topicLower)) return ['aristocrat', 'politician'];
  if (/\b(technology|ai|future|progress|internet)\b/.test(topicLower)) return ['corporate', 'philosopher'];
  if (/\b(hope|kindness|care|love|sincerity)\b/.test(topicLower) && unlockedFrogs.includes('sincerity')) return ['sincerity', 'doomer'];
  const shuffled = [...allFrogs].sort(() => Math.random() - 0.5);
  return [shuffled[0], shuffled[1]];
}

// ─── Prompt builders — all return OneShotPrompt ───────────────────────────────
//
// Pattern: systemPrompt = frog.systemPrompt + memoryContext
//          userContext   = the situational instruction that was previously
//                         embedded in the Gemma <start_of_turn> block

export function buildDebateOpeningPrompt(
  frog: FrogConfig,
  topic: string,
  opponentName: string,
  memoryContext = ''
): OneShotPrompt {
  return {
    systemPrompt: `${frog.systemPrompt}${memoryContext}`,
    userContext:
      `You are about to debate ${opponentName} on the topic: "${topic}"\n\n` +
      `Make your OPENING STATEMENT — 2 sentences MAX. ` +
      `State your position clearly, in your own voice. ` +
      `Be provocative enough that ${opponentName} will want to respond. ` +
      `Stay completely in character.`,
  };
}

export function buildDebateResponsePrompt(
  frog: FrogConfig,
  topic: string,
  opponentName: string,
  opponentStatement: string,
  round: number,
  memoryContext = ''
): OneShotPrompt {
  const isLastRound = round >= DEBATE_ROUNDS;
  const instruction = isLastRound
    ? `This is your FINAL REBUTTAL. Make it count — 2 sentences MAX, devastating, in character.`
    : `Respond to what ${opponentName} just said — 2 sentences MAX, stay in character.`;

  return {
    systemPrompt: `${frog.systemPrompt}${memoryContext}`,
    userContext:
      `You are debating ${opponentName} on the topic: "${topic}"\n` +
      `${opponentName} just said: "${opponentStatement.trim()}"\n\n` +
      instruction,
  };
}

export function buildInterruptionPrompt(
  interruptingFrog: FrogConfig,
  lastUserMessage: string,
  activeFrogName: string,
  activeFrogResponse: string,
  isEasterEgg = false,
  memoryContext = ''
): OneShotPrompt {
  const urgency = isEasterEgg
    ? `This topic is DIRECTLY in your wheelhouse — you physically cannot stay silent.`
    : `You cannot help yourself.`;

  return {
    systemPrompt: `${interruptingFrog.systemPrompt}${memoryContext}`,
    userContext:
      `You have been lurking in the pond watching this exchange:\n` +
      `${activeFrogName} just said: "${activeFrogResponse.trim()}"\n` +
      `The user had said: "${lastUserMessage.trim()}"\n\n` +
      `${urgency} Jump in with ONE reactive line — 1 sentence MAX. ` +
      `React to what you just witnessed. Stay completely in character. ` +
      `Do not address the user directly.`,
  };
}

export function shouldFireLastWord(): boolean {
  return Math.random() < LAST_WORD_CHANCE;
}

export function buildLastWordPrompt(
  activeFrog: FrogConfig,
  interruptingFrogName: string,
  interruptingFrogResponse: string,
  memoryContext = ''
): OneShotPrompt {
  return {
    systemPrompt: `${activeFrog.systemPrompt}${memoryContext}`,
    userContext:
      `You were just interrupted by ${interruptingFrogName} who cut in and said: ` +
      `"${interruptingFrogResponse.trim()}"\n\n` +
      `You cannot let that stand. Fire back with ONE dismissive line — 1 sentence MAX. ` +
      `Stay completely in character. Address ${interruptingFrogName} directly.`,
  };
}

export function pickSilenceFrog(unlockedFrogs?: FrogId[]): FrogId {
  const frogs = Object.values(FROGS).filter(
    (f) => !f.hidden || unlockedFrogs?.includes(f.id)
  );
  const total = frogs.reduce((s, f) => s + f.interruptWeight, 0);
  let roll = Math.random() * total;
  for (const frog of frogs) {
    roll -= frog.interruptWeight;
    if (roll <= 0) return frog.id;
  }
  return frogs[frogs.length - 1].id;
}

export function buildSilencePrompt(frog: FrogConfig, memoryContext = ''): OneShotPrompt {
  return {
    systemPrompt: `${frog.systemPrompt}${memoryContext}`,
    userContext:
      `The pond has been completely silent. The user is still there — you can feel it. ` +
      `Say ONE unprompted thing into the void — 1 sentence MAX. ` +
      `Do not ask a question. Do not address the user directly. Stay completely in character.`,
  };
}

export function buildPokePrompt(
  frog: FrogConfig,
  pokedMessage: string,
  memoryContext = ''
): OneShotPrompt {
  return {
    systemPrompt: `${frog.systemPrompt}${memoryContext}`,
    userContext:
      `The user just tapped on something you said earlier: "${pokedMessage.trim()}"\n\n` +
      `React to being poked — ONE sentence MAX. Stay completely in character.`,
  };
}

// ─── Image reaction prompt ────────────────────────────────────────────────────

export function buildImageReactionPrompt(
  frog: FrogConfig,
  imageDataUrl: string,
  memoryContext = ''
): ImagePrompt {
  return {
    systemPrompt: `${frog.systemPrompt}${memoryContext}`,
    userContext:
      `The user just dropped an image into the pond. ` +
      `React to it in ONE sentence MAX. Stay completely in character. ` +
      `Do not describe the image literally — react to it the way you would react to anything, ` +
      `filtered entirely through your personality.`,
    imageDataUrl,
  };
}

// ─── Frog agreement ───────────────────────────────────────────────────────────

const AGREEMENT_CHANCE = 0.17;

const AGREEMENT_WEIGHTS: Record<FrogId, number> = {
  shitposter:  7,
  doomer:      4,
  philosopher: 5,
  corporate:   6,
  politician:  8,
  aristocrat:  1,
  sincerity:   9,
};

export function shouldFireAgreement(): boolean {
  return Math.random() < AGREEMENT_CHANCE;
}

export function pickAgreementFrog(activeFrogId: FrogId, unlockedFrogs: FrogId[] = []): FrogId | null {
  const candidates = Object.entries(AGREEMENT_WEIGHTS).filter(([id]) => {
    if (id === activeFrogId) return false;
    const frog = FROGS[id as FrogId];
    if (frog.hidden && !unlockedFrogs.includes(id as FrogId)) return false;
    return true;
  });
  const total = candidates.reduce((s, [, w]) => s + w, 0);
  let roll = Math.random() * total;
  for (const [id, weight] of candidates) {
    roll -= weight;
    if (roll <= 0) return id as FrogId;
  }
  return candidates[candidates.length - 1][0] as FrogId;
}

export function buildAgreementPrompt(
  agreeingFrog: FrogConfig,
  activeFrogName: string,
  activeFrogResponse: string,
  memoryContext = ''
): OneShotPrompt {
  return {
    systemPrompt: `${agreeingFrog.systemPrompt}${memoryContext}`,
    userContext:
      `You have been lurking in the pond and just heard ${activeFrogName} say: ` +
      `"${activeFrogResponse.trim()}"\n\n` +
      `You find yourself — perhaps reluctantly, perhaps enthusiastically — agreeing with this. ` +
      `Express your agreement in ONE sentence MAX. Stay completely in character. ` +
      `Your agreement should sound exactly like YOU agreeing, not like a generic endorsement. ` +
      `Do not just say "I agree" — show it through your own lens. ` +
      `Do not address the user directly.`,
  };
}