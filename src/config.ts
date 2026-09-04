/**
 * Runtime configuration, sourced exclusively from environment variables.
 *
 * `getConfig()` is intentionally evaluated per call (it is cheap) so that:
 *  - serverless cold starts always see the current environment, and
 *  - tests can stub / unstub env vars between cases.
 *
 * No credentials are required: domain checks go straight to public RDAP
 * servers, resolved via the IANA bootstrap registry.
 */

export interface AppConfig {
  readonly requestTimeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60_000;

function parseTimeout(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") {
    return DEFAULT_TIMEOUT_MS;
  }
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.max(Math.trunc(value), MIN_TIMEOUT_MS), MAX_TIMEOUT_MS);
}

export function getConfig(): AppConfig {
  return {
    requestTimeoutMs: parseTimeout(process.env.REQUEST_TIMEOUT_MS),
  };
}

export interface RateLimitConfig {
  /** Max tool calls allowed per client per window. `0` disables rate limiting. */
  readonly max: number;
  /** Window length in milliseconds. */
  readonly windowMs: number;
}

const DEFAULT_RATE_LIMIT_MAX = 15;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 60_000;

function parseIntEnv(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

/**
 * Per-client rate limit for the public HTTP deployment. Protects upstream
 * RDAP servers from a single abusive caller. Configurable via
 * `RATE_LIMIT_MAX` (set to `0` to disable) and `RATE_LIMIT_WINDOW_MS`.
 */
export function getRateLimitConfig(): RateLimitConfig {
  const rawMax = process.env.RATE_LIMIT_MAX;
  const max =
    rawMax !== undefined && rawMax.trim() === "0"
      ? 0
      : parseIntEnv(rawMax, DEFAULT_RATE_LIMIT_MAX, 1, 100_000);
  return {
    max,
    windowMs: parseIntEnv(
      process.env.RATE_LIMIT_WINDOW_MS,
      DEFAULT_RATE_LIMIT_WINDOW_MS,
      1_000,
      3_600_000,
    ),
  };
}
