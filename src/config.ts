/**
 * Runtime configuration, sourced exclusively from environment variables.
 *
 * `getConfig()` is intentionally evaluated per call (it is cheap) so that:
 *  - serverless cold starts always see the current environment, and
 *  - tests can stub / unstub env vars between cases.
 *
 * The RapidAPI key is NEVER hard-coded and NEVER logged.
 */

import { ConfigurationError } from "./utils/errors.js";

export interface AppConfig {
  readonly rapidApiKey: string;
  readonly rapidApiHost: string;
  readonly rapidApiUrl: string;
  readonly requestTimeoutMs: number;
}

const DEFAULT_HOST = "domainstatus.p.rapidapi.com";
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

/**
 * Reads and validates configuration.
 * @throws {ConfigurationError} when `RAPIDAPI_KEY` is missing/empty.
 */
export function getConfig(): AppConfig {
  const rapidApiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!rapidApiKey) {
    throw new ConfigurationError("RAPIDAPI_KEY is not configured.");
  }

  const rapidApiHost = (process.env.RAPIDAPI_HOST?.trim() || DEFAULT_HOST).toLowerCase();

  return {
    rapidApiKey,
    rapidApiHost,
    rapidApiUrl: `https://${rapidApiHost}/v1/domain/available`,
    requestTimeoutMs: parseTimeout(process.env.RAPIDAPI_TIMEOUT_MS),
  };
}

/** True when a RapidAPI key is present. Used by the health endpoint (never exposes the value). */
export function isConfigured(): boolean {
  return Boolean(process.env.RAPIDAPI_KEY?.trim());
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
 * Per-client rate limit for the public HTTP deployment. Protects the shared
 * RapidAPI quota from a single abusive caller. Configurable via
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
