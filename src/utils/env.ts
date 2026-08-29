/**
 * Loads a local `.env` file into `process.env` for local development.
 *
 * - Uses Node's built-in `process.loadEnvFile` (Node >= 20.12) — no dependency.
 * - Never overrides variables that are already set (platform env wins).
 * - A missing `.env` is fine (this is the case on Vercel, where variables are
 *   injected by the platform).
 *
 * Import this module for its side effect **before** anything reads `process.env`.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");

if (existsSync(envPath)) {
  try {
    // Available since Node 20.12 / 21.7; local dev only.
    (process as unknown as { loadEnvFile?: (path: string) => void }).loadEnvFile?.(envPath);
  } catch {
    // Ignore — fall back to whatever is already in the environment.
  }
}
