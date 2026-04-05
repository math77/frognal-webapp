'use client';

/**
 * requestQueue.ts — client-side rate limiting.
 *
 * Two mechanisms:
 *
 * 1. RequestQueue — serializes all one-shot API calls (interruptions, debate
 *    turns, silence, poke, agreement) with a minimum gap between them.
 *    Prevents the burst that happens when a main reply + interruption +
 *    agreement all fire within milliseconds of each other.
 *
 * 2. RequestBudget — tracks how many requests have been sent in the last
 *    60 seconds. The interruption/agreement code checks this before firing
 *    and skips if the budget is tight, providing graceful degradation instead
 *    of hard 429s.
 */

// ─── 1. RequestQueue ──────────────────────────────────────────────────────────

/** Minimum gap between queued one-shot requests (ms). */
const ONESHOT_GAP_MS = 400;

class RequestQueue {
  private queue:   (() => Promise<void>)[] = [];
  private running  = false;
  private lastEnd  = 0;

  /** Enqueue a one-shot task. Returns a promise that resolves when the task completes. */
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try { resolve(await task()); }
        catch (err) { reject(err); }
      });
      this.drain();
    });
  }

  private async drain() {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const task = this.queue.shift()!;

      // Enforce minimum gap since the last request finished
      const wait = Math.max(0, this.lastEnd + ONESHOT_GAP_MS - Date.now());
      if (wait > 0) await sleep(wait);

      await task();
      this.lastEnd = Date.now();
    }

    this.running = false;
  }
}

export const oneShotQueue = new RequestQueue();

// ─── 2. RequestBudget ─────────────────────────────────────────────────────────

/** Rolling window for client-side budget tracking (ms). */
const BUDGET_WINDOW_MS = 60_000;

/**
 * When the client has sent this many requests in the last minute,
 * start skipping low-priority generations (interruptions, agreements).
 */
export const BUDGET_SOFT_LIMIT = 12;

/**
 * When the client has sent this many requests, skip ALL side-channel
 * generations. Main frog replies still go through.
 */
export const BUDGET_HARD_LIMIT = 18;

class RequestBudget {
  private timestamps: number[] = [];

  /** Call this every time a request is sent. */
  record() {
    const now = Date.now();
    this.timestamps.push(now);
    // Prune old entries
    this.timestamps = this.timestamps.filter(t => now - t < BUDGET_WINDOW_MS);
  }

  /** How many requests have been sent in the last minute. */
  get count(): number {
    const now = Date.now();
    return this.timestamps.filter(t => now - t < BUDGET_WINDOW_MS).length;
  }

  /** True if we're at or above the soft limit. */
  get isTight(): boolean { return this.count >= BUDGET_SOFT_LIMIT; }

  /** True if we're at or above the hard limit — skip everything optional. */
  get isExhausted(): boolean { return this.count >= BUDGET_HARD_LIMIT; }
}

export const requestBudget = new RequestBudget();

// ─── Util ─────────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
