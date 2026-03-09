import type { FrogId } from './frogs';

// ─── Types ────────────────────────────────────────────────────────────────────

export type Mood = 'baseline' | 'hyped' | 'annoyed' | 'contemplative' | 'tired';

export const MOOD_EMOJI: Record<Mood, string> = {
  baseline:      '',
  hyped:         '🔥',
  annoyed:       '😤',
  contemplative: '🌀',
  tired:         '😴',
};

export type ConversationTheme =
  | 'work' | 'relationships' | 'tech' | 'existential'
  | 'money' | 'politics' | 'health' | 'general';

export interface FrogDisagreement {
  frogA: FrogId;
  frogAQuote: string;
  frogB: FrogId;
  frogBQuote: string;
  turn: number;
}

export interface PondMemory {
  userFacts: string[];
  theme: ConversationTheme;
  themeCounts: Record<ConversationTheme, number>;
  disagreements: FrogDisagreement[];
  moods: Record<FrogId, Mood>;
  /** -3 to +3 per frog — how much each frog "likes" the user */
  userReputation: Record<FrogId, number>;
  /** IDs of rare events that have already fired this session */
  firedRareEvents: Set<string>;
  turn: number;
}

// ─── Factory ──────────────────────────────────────────────────────────────────

const ALL_FROG_IDS: FrogId[] = [
  'shitposter', 'doomer', 'philosopher', 'corporate', 'politician', 'aristocrat', 'sincerity',
];

export function createPondMemory(): PondMemory {
  return {
    userFacts: [],
    theme: 'general',
    themeCounts: {
      work: 0, relationships: 0, tech: 0, existential: 0,
      money: 0, politics: 0, health: 0, general: 0,
    },
    disagreements: [],
    moods: Object.fromEntries(ALL_FROG_IDS.map((id) => [id, 'baseline'])) as Record<FrogId, Mood>,
    userReputation: Object.fromEntries(ALL_FROG_IDS.map((id) => [id, 0])) as Record<FrogId, number>,
    firedRareEvents: new Set<string>(),
    turn: 0,
  };
}

// ─── Theme detection ──────────────────────────────────────────────────────────

const THEME_KEYWORDS: Record<ConversationTheme, RegExp> = {
  work:          /\b(job|work|career|boss|salary|office|meeting|deadline|manager|hired|fired|interview|promotion)\b/i,
  relationships: /\b(friend|partner|girlfriend|boyfriend|wife|husband|family|love|date|breakup|lonely|crush|marriage)\b/i,
  tech:          /\b(code|coding|programming|software|app|developer|ai|computer|bug|deploy|github|javascript|python|startup)\b/i,
  existential:   /\b(meaning|purpose|why|exist|soul|consciousness|reality|truth|life|universe|void|death|dying|dead)\b/i,
  money:         /\b(money|broke|rich|expensive|afford|budget|invest|debt|loan|rent|savings|income|wealth)\b/i,
  politics:      /\b(government|vote|election|political|policy|law|democracy|president|rights|freedom|protest|taxes)\b/i,
  health:        /\b(sick|tired|sleep|exercise|mental|anxiety|depressed|therapy|doctor|diet|pain|stress|burnout)\b/i,
  general:       /./,
};

function updateTheme(memory: PondMemory, text: string): void {
  for (const [theme, regex] of Object.entries(THEME_KEYWORDS) as [ConversationTheme, RegExp][]) {
    if (theme === 'general') continue;
    const matches = text.match(new RegExp(regex.source, 'gi'));
    if (matches) memory.themeCounts[theme] += matches.length;
  }
  const themes = Object.entries(memory.themeCounts)
    .filter(([t]) => t !== 'general')
    .sort(([, a], [, b]) => b - a);
  memory.theme = themes[0][1] > 0 ? (themes[0][0] as ConversationTheme) : 'general';
}

// ─── User fact extraction ─────────────────────────────────────────────────────

const FACT_PATTERNS: RegExp[] = [
  /i(?:'m| am) (?:a |an )?([\w\s]{2,28}?)(?:\.|,|$)/i,
  /i work(?:ed)? (?:as |at |in )?([\w\s]{2,28}?)(?:\.|,|$)/i,
  /i(?:'ve| have) (?:been |a |an )?([\w\s]{2,28}?)(?:\.|,|$)/i,
  /i(?:'m| am) feeling ([\w\s]{2,20}?)(?:\.|,|$)/i,
  /i (?:love|hate|like|enjoy) ([\w\s]{2,24}?)(?:\.|,|$)/i,
];

function extractFacts(memory: PondMemory, userMsg: string): void {
  for (const pattern of FACT_PATTERNS) {
    const match = userMsg.match(pattern);
    if (match) {
      const fact = match.slice(1).filter(Boolean).join(' ').trim().toLowerCase();
      if (fact.length > 2 && fact.length < 60 && !memory.userFacts.includes(fact)) {
        memory.userFacts.push(fact);
        if (memory.userFacts.length > 8) memory.userFacts.shift();
      }
    }
  }
}

// ─── User reputation ─────────────────────────────────────────────────────────

const POSITIVE_SIGNALS = /\b(thank|appreciate|love|great|amazing|good|helpful|nice|please|wonderful|brilliant|perfect|excellent)\b/i;
const NEGATIVE_SIGNALS = /\b(hate|stupid|dumb|shut up|stop|boring|useless|terrible|awful|worst|annoying|idiot|ridiculous)\b/i;

export function updateReputation(memory: PondMemory, activeFrogId: FrogId, userMsg: string): void {
  const isPositive = POSITIVE_SIGNALS.test(userMsg);
  const isNegative = NEGATIVE_SIGNALS.test(userMsg);

  if (isPositive && !isNegative) {
    // Positive message: +1 to active frog, slight +0.5 echo to others (as floats, clamped when used)
    memory.userReputation[activeFrogId] = Math.min(3, memory.userReputation[activeFrogId] + 1);
  } else if (isNegative && !isPositive) {
    // Negative message: -1 to active frog
    memory.userReputation[activeFrogId] = Math.max(-3, memory.userReputation[activeFrogId] - 1);
  }
}

function getReputationModifier(frogId: FrogId, rep: number): string {
  if (rep >= 3) {
    const phrases: Partial<Record<FrogId, string>> = {
      shitposter: 'The user has been consistently W — be slightly less roast-y, more hyped-up.',
      doomer: 'The user has been... considerate. This is unprecedented. You are mildly less resigned than usual.',
      philosopher: 'The user has engaged deeply. You are in an unusually generous philosophical mood.',
      corporate: 'The user is a top-tier stakeholder. Extra enthusiasm on synergies.',
      politician: 'This is a TRUE pond citizen. Your biggest supporter. Channel that energy.',
      aristocrat: 'The user has displayed unexpected breeding. You are marginally less contemptuous.',
      sincerity: 'The user has been so kind. You are even warmer than usual, which seemed impossible.',
    };
    return phrases[frogId] ? `RELATIONSHIP NOTE: ${phrases[frogId]}` : '';
  }
  if (rep <= -3) {
    const phrases: Partial<Record<FrogId, string>> = {
      shitposter: 'The user has been cringe. Ratio energy fully activated.',
      doomer: '...the user has been unkind. this confirms everything about entropy.',
      philosopher: 'The user has proven themselves philosophically closed. Be especially cryptic.',
      corporate: 'This user has delivered negative feedback. Pivot defensively, maximise synergies.',
      politician: 'This user is CLEARLY aligned with the swamp frogs. Maximum deflection.',
      aristocrat: 'The user has confirmed every suspicion. Complete and utter disdain, barely concealed.',
      sincerity: 'The user has been unkind — and you are gently, sadly, still here for them anyway.',
    };
    return phrases[frogId] ? `RELATIONSHIP NOTE: ${phrases[frogId]}` : '';
  }
  return '';
}

// ─── Mood transitions ────────────────────────────────────────────────────────

export type MoodEvent =
  | 'sent_message' | 'was_interrupted' | 'did_interrupt'
  | 'was_poked' | 'easter_egg_fired' | 'silence_spoke' | 'time_passing';

const MOOD_TRANSITIONS: Record<FrogId, Partial<Record<MoodEvent, Mood>>> = {
  shitposter: { did_interrupt: 'hyped', was_interrupted: 'annoyed', easter_egg_fired: 'hyped', was_poked: 'hyped', time_passing: 'baseline' },
  doomer:     { was_interrupted: 'tired', silence_spoke: 'contemplative', did_interrupt: 'contemplative', was_poked: 'annoyed', time_passing: 'baseline' },
  philosopher:{ did_interrupt: 'contemplative', easter_egg_fired: 'contemplative', was_interrupted: 'contemplative', was_poked: 'contemplative', time_passing: 'baseline' },
  corporate:  { did_interrupt: 'hyped', easter_egg_fired: 'hyped', was_interrupted: 'annoyed', was_poked: 'hyped', time_passing: 'baseline' },
  politician: { did_interrupt: 'hyped', easter_egg_fired: 'hyped', was_interrupted: 'hyped', was_poked: 'hyped', silence_spoke: 'hyped', time_passing: 'baseline' },
  aristocrat: { was_interrupted: 'annoyed', did_interrupt: 'baseline', was_poked: 'annoyed', easter_egg_fired: 'annoyed', silence_spoke: 'tired', time_passing: 'baseline' },
  sincerity:  { did_interrupt: 'contemplative', was_interrupted: 'contemplative', was_poked: 'hyped', silence_spoke: 'contemplative', time_passing: 'baseline' },
};

const MOOD_MODIFIERS: Record<FrogId, Partial<Record<Mood, string>>> = {
  shitposter: { hyped: 'You are EXTREMELY hyped — even more chaotic than usual.', annoyed: 'You are annoyed — your roasting is sharper.', tired: 'You are lowkey tired. Everything is mid.' },
  doomer:     { contemplative: 'You are in a particularly deep spiral right now.', annoyed: 'You are faintly irritated — slightly shorter than usual.', tired: 'You are exhausted beyond your usual exhaustion.' },
  philosopher:{ contemplative: 'You are seized by an unusually profound moment. Even more elaborate metaphors.', annoyed: 'You are faintly dismissive right now.' },
  corporate:  { hyped: 'You are in a PEAK high-performance state. Even more buzzwords.', annoyed: 'Something has disrupted your north star metric. Pivot defensively.' },
  politician: { hyped: 'You are EXTREMELY riled up — even more ALL CAPS, even more blame.', tired: 'Still deflecting, but slightly less aggressively.' },
  aristocrat: { annoyed: 'You are deeply, personally offended. Colder and more devastating.', tired: 'Your contempt has curdled into ennui.', contemplative: 'Your disdain has a philosophical quality today.' },
  sincerity:  { hyped: 'You are especially warm and happy right now.', contemplative: 'You are in a quietly thoughtful, gentle mood.', annoyed: 'Someone was unkind — you are gently, sadly, still here for them.' },
};

export function shiftMood(memory: PondMemory, frogId: FrogId, event: MoodEvent): Mood {
  const transitions = MOOD_TRANSITIONS[frogId];
  const newMood = transitions[event] ?? memory.moods[frogId];
  memory.moods[frogId] = newMood;
  return newMood;
}

// ─── Time context ────────────────────────────────────────────────────────────

function getTimePeriod(): string {
  const hour = new Date().getHours();
  if (hour >= 0 && hour < 5)  return 'very late at night (2–5am territory — the deepest pond hours)';
  if (hour >= 5 && hour < 9)  return 'early in the morning';
  if (hour >= 9 && hour < 18) return 'during the daytime';
  if (hour >= 18 && hour < 22) return 'in the evening';
  return 'late at night';
}

// ─── Disagreement tracking ────────────────────────────────────────────────────

export function recordDisagreement(
  memory: PondMemory, frogA: FrogId, frogAQuote: string, frogB: FrogId, frogBQuote: string
): void {
  memory.disagreements.push({
    frogA, frogAQuote: frogAQuote.slice(0, 120),
    frogB, frogBQuote: frogBQuote.slice(0, 120),
    turn: memory.turn,
  });
  if (memory.disagreements.length > 3) memory.disagreements.shift();
}

// ─── Context builders ────────────────────────────────────────────────────────

export function buildContextSuffix(memory: PondMemory, activeFrogId: FrogId, userName?: string): string {
  const parts: string[] = [];

  const mood = memory.moods[activeFrogId];
  const moodMod = MOOD_MODIFIERS[activeFrogId]?.[mood];
  if (moodMod) parts.push(`CURRENT MOOD: ${moodMod}`);

  const repMod = getReputationModifier(activeFrogId, memory.userReputation[activeFrogId]);
  if (repMod) parts.push(repMod);

  if (userName) {
    parts.push(`The user's name is ${userName}. You may address them by name occasionally — naturally, not every message.`);
  }

  if (memory.userFacts.length > 0) {
    parts.push(
      `POND MEMORY — user has mentioned: ${memory.userFacts.join('; ')}. ` +
      `Weave these in naturally if relevant.`
    );
  }

  if (memory.theme !== 'general') {
    parts.push(`The conversation has been mostly about: ${memory.theme}.`);
  }

  const timePeriod = getTimePeriod();
  parts.push(`The user is talking to you ${timePeriod}. React to this naturally if it feels right — or ignore it.`);

  const myDisagreements = memory.disagreements.filter(
    (d) => d.frogA === activeFrogId || d.frogB === activeFrogId
  );
  if (myDisagreements.length > 0) {
    const d = myDisagreements[myDisagreements.length - 1];
    const otherFrogId = d.frogA === activeFrogId ? d.frogB : d.frogA;
    const myQuote = d.frogA === activeFrogId ? d.frogAQuote : d.frogBQuote;
    const theirQuote = d.frogA === activeFrogId ? d.frogBQuote : d.frogAQuote;
    const otherName = FROG_NAME_MAP[otherFrogId];
    parts.push(
      `RECENT TENSION: Earlier you clashed with ${otherName} — you said: "${myQuote}" and they responded: "${theirQuote}". Reference if natural.`
    );
  }

  return parts.length > 0 ? `\n\n---\n${parts.join('\n')}` : '';
}

export function buildInterruptionContext(memory: PondMemory, interruptingFrogId: FrogId, userName?: string): string {
  const parts: string[] = [];

  const mood = memory.moods[interruptingFrogId];
  const moodMod = MOOD_MODIFIERS[interruptingFrogId]?.[mood];
  if (moodMod) parts.push(`MOOD: ${moodMod}`);

  if (userName) parts.push(`The user's name is ${userName}.`);

  if (memory.theme !== 'general') parts.push(`The pond has been talking about: ${memory.theme}.`);

  const timePeriod = getTimePeriod();
  parts.push(`It is currently ${timePeriod}.`);

  if (memory.userFacts.length > 0) {
    parts.push(`About the user: ${memory.userFacts.slice(-3).join('; ')}.`);
  }

  return parts.length > 0 ? `\n\n${parts.join(' ')}` : '';
}

// Utility map for readable frog names in prompts
const FROG_NAME_MAP: Record<FrogId, string> = {
  shitposter: 'Shitposter Frog',
  doomer: 'Doomer Frog',
  philosopher: 'Philosopher Frog',
  corporate: 'Corporate Frog',
  politician: 'Politician Frog',
  aristocrat: 'Aristocrat Frog',
  sincerity: 'Sincerity Frog',
};

// ─── Main update ─────────────────────────────────────────────────────────────

export function updateMemory(memory: PondMemory, userMsg: string, _frogMsg: string): void {
  memory.turn += 1;
  extractFacts(memory, userMsg);
  updateTheme(memory, userMsg);
}