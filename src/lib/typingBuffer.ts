import type { TypingProfile } from './frogs';

/**
 * createTypingBuffer
 *
 * Sits between the API token stream and the UI.
 * Tokens land in a queue; a timer drains the queue at the frog's pace.
 *
 * NEW: thinkingMs — the frog shows typing dots for this long before the
 * first character appears. Makes fast API responses feel like the frog
 * is actually composing a thought rather than instantly regurgitating.
 */
export function createTypingBuffer(
  profile: TypingProfile,
  onDisplay: (chunk: string) => void
): {
  queue:    (token: string, done: boolean) => void;
  finished: Promise<void>;
} {
  let pending         = '';
  let generationDone  = false;
  let firstCharShown  = false;
  let resolveFinished!: () => void;

  const finished = new Promise<void>(resolve => { resolveFinished = resolve; });

  const thinkingMs = profile.thinkingMs ?? 0;

  const drain = () => {
    if (pending.length === 0) {
      if (generationDone) { resolveFinished(); return; }
      setTimeout(drain, profile.msPerTick);
      return;
    }

    const timingMult = 1 + (Math.random() - 0.5) * profile.variance * 2;
    const sizeMult   = 1 + (Math.random() - 0.5) * profile.variance * 2;
    const burst      = Math.max(1, Math.round(profile.charsPerTick * sizeMult));
    const chunk      = pending.slice(0, burst);
    pending          = pending.slice(burst);

    onDisplay(chunk);

    const nextDelay = Math.max(8, Math.round(profile.msPerTick * timingMult));
    setTimeout(drain, nextDelay);
  };

  // Delay the first drain tick by thinkingMs to simulate composing
  const initialDelay = thinkingMs > 0
    ? thinkingMs + Math.round((Math.random() - 0.5) * thinkingMs * 0.3)
    : profile.msPerTick;

  setTimeout(drain, initialDelay);

  return {
    queue: (token: string, done: boolean) => {
      pending += token;
      if (done) generationDone = true;
    },
    finished,
  };
}
