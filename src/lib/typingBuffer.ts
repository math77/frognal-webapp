import type { TypingProfile } from './frogs';

/**
 * createTypingBuffer
 *
 * Sits between MediaPipe's token stream and the UI.
 * Tokens land in a queue; a timer drains the queue at the frog's pace.
 *
 * This gives each frog a distinct "feel":
 *  - Doomer: agonisingly slow, one char at a time
 *  - Aristocrat: same — choosing every word with disdain
 *  - Shitposter: fast chaotic bursts
 *  - Corporate: fast, robotic consistency
 *  - Politician: erratic, sometimes surging sometimes stalling
 *  - Philosopher: measured, deliberate
 *
 * Usage:
 *   const { queue, finished } = createTypingBuffer(frog.typingProfile, chunk => {
 *     setDisplayMessages(prev => prev.map(m =>
 *       m.id === msgId ? { ...m, content: m.content + chunk } : m
 *     ))
 *   })
 *
 *   await generate(text, queue)   // queue receives tokens as they arrive
 *   await finished                // resolves when buffer fully drains
 */
export function createTypingBuffer(
  profile: TypingProfile,
  onDisplay: (chunk: string) => void
): {
  queue: (token: string, done: boolean) => void;
  finished: Promise<void>;
} {
  let pending = '';
  let generationDone = false;
  let resolveFinished!: () => void;

  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const tick = () => {
    // Nothing pending yet — check back shortly
    if (pending.length === 0) {
      if (generationDone) {
        resolveFinished();
        return;
      }
      setTimeout(tick, profile.msPerTick);
      return;
    }

    // Apply variance to both timing and burst size
    const timingMult = 1 + (Math.random() - 0.5) * profile.variance * 2;
    const sizeMult   = 1 + (Math.random() - 0.5) * profile.variance * 2;

    const burst = Math.max(1, Math.round(profile.charsPerTick * sizeMult));
    const chunk = pending.slice(0, burst);
    pending = pending.slice(burst);

    onDisplay(chunk);

    const nextDelay = Math.max(8, Math.round(profile.msPerTick * timingMult));
    setTimeout(tick, nextDelay);
  };

  // Kick off the first tick
  setTimeout(tick, profile.msPerTick);

  return {
    queue: (token: string, done: boolean) => {
      pending += token;
      if (done) generationDone = true;
    },
    finished,
  };
}