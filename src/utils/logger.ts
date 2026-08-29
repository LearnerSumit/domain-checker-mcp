/**
 * Minimal structured logger.
 *
 * - Writes single-line JSON to **stderr** (keeps stdout clean for the stdio MCP
 *   transport and is the correct stream for serverless log capture).
 * - Never logs secrets: any string field whose value contains the RapidAPI key
 *   is redacted, and callers are expected to pass only safe metadata anyway
 *   (no headers, no request bodies with credentials).
 */

import { redactSecret } from "./errors.js";

const LEVELS = ["debug", "info", "warn", "error", "silent"] as const;
export type LogLevel = (typeof LEVELS)[number];

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  return (LEVELS as readonly string[]).includes(raw) ? (raw as LogLevel) : "info";
}

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

type Meta = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(key|secret|token|authorization|password|cookie)/i;

function sanitize(meta: Meta | undefined): Meta | undefined {
  if (!meta) return undefined;
  const secret = process.env.RAPIDAPI_KEY;
  const out: Meta = {};
  for (const [k, v] of Object.entries(meta)) {
    if (SENSITIVE_KEY_PATTERN.test(k)) {
      out[k] = "***REDACTED***";
      continue;
    }
    out[k] = typeof v === "string" ? redactSecret(v, secret) : v;
  }
  return out;
}

function emit(level: Exclude<LogLevel, "silent">, message: string, meta?: Meta): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[resolveLevel()]) {
    return;
  }
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    message,
    ...sanitize(meta),
  });
  // eslint-disable-next-line no-console
  console.error(line);
}

export const logger = {
  debug: (message: string, meta?: Meta) => emit("debug", message, meta),
  info: (message: string, meta?: Meta) => emit("info", message, meta),
  warn: (message: string, meta?: Meta) => emit("warn", message, meta),
  error: (message: string, meta?: Meta) => emit("error", message, meta),
};
