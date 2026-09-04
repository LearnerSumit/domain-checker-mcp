/**
 * Tiny in-memory fixed-window rate limiter.
 *
 * Scope note: on serverless (Vercel) the counter lives in a single warm
 * instance's memory, so the effective limit is *per instance*, not global. That
 * is intentional and sufficient here — it stops a single client from hammering
 * upstream RDAP servers, without adding a datastore dependency. For strict
 * global limits, put the Vercel Firewall / a KV store in front.
 */

interface Window {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Window>();
let lastSweep = 0;

function sweep(now: number): void {
  // Opportunistic cleanup so the map cannot grow unbounded.
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, win] of buckets) {
    if (win.resetAt <= now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets (only meaningful when `ok` is false). */
  retryAfterSec: number;
  remaining: number;
}

/**
 * Records a hit for `key` and reports whether it is within `max` per `windowMs`.
 * When `max <= 0` the limiter is disabled and every call passes.
 */
export function rateLimit(
  key: string,
  max: number,
  windowMs: number,
  now: number = Date.now(),
): RateLimitResult {
  if (max <= 0) {
    return { ok: true, retryAfterSec: 0, remaining: Number.POSITIVE_INFINITY };
  }

  sweep(now);

  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0, remaining: max - 1 };
  }

  existing.count += 1;
  if (existing.count > max) {
    return {
      ok: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      remaining: 0,
    };
  }
  return { ok: true, retryAfterSec: 0, remaining: max - existing.count };
}

/** Test helper — clears all counters. */
export function resetRateLimiter(): void {
  buckets.clear();
  lastSweep = 0;
}

/**
 * Best-effort client identifier from proxy headers (Vercel sets
 * `x-forwarded-for` / `x-real-ip`). Falls back to a constant so local/stdio use
 * still works (and shares one bucket, which is fine).
 */
export function clientKeyFromRequest(req: Request | undefined): string {
  if (!req) return "local";
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
