/**
 * rateLimiter.ts — server-side per-IP rate limiting.
 * In-memory; works well for single-instance dev and Vercel (each instance
 * has its own budget, which is acceptable — the goal is preventing one user
 * from bursting the shared quota, not global enforcement).
 *
 * Limits:
 *   WINDOW_MS  — rolling window (60 seconds)
 *   MAX_RPM    — max requests per IP per window
 */

const WINDOW_MS = 60_000;
const MAX_RPM   = 20; // per IP per minute — well under the 15 RPM global cap to leave room for concurrency

interface Bucket {
  count:     number;
  resetAt:   number;
}

// Module-level map persists across requests within the same serverless instance
const buckets = new Map<string, Bucket>();

/** Returns true if the request should be blocked. */
export function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let bucket = buckets.get(ip);

  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 0, resetAt: now + WINDOW_MS };
    buckets.set(ip, bucket);
  }

  bucket.count += 1;
  return bucket.count > MAX_RPM;
}

/** Returns seconds until the bucket resets (for Retry-After header). */
export function retryAfterSeconds(ip: string): number {
  const bucket = buckets.get(ip);
  if (!bucket) return 0;
  return Math.ceil((bucket.resetAt - Date.now()) / 1000);
}

// Prune stale entries every 5 minutes to avoid memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}, 300_000);
