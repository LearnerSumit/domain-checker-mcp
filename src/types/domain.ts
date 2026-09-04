/**
 * Types for the cleaned domain availability result the MCP tool returns.
 */

import { z } from "zod";

/** Clean, AI-friendly result surfaced by the MCP tool. */
export interface DomainAvailabilityResult {
  /** Fully-qualified domain, e.g. `mybrand.ai`. */
  domain: string;
  /** Normalised second-level name, e.g. `mybrand`. */
  name: string;
  /** Normalised TLD, e.g. `ai`. */
  tld: string;
  /** `true` when the domain is available for registration. */
  available: boolean;
  /** Whether the TLD is a valid, RDAP-registered TLD. */
  tldValid: boolean | null;
  /** Method used to determine availability, e.g. `rdap`. */
  checkMethod: string | null;
  /** How long the lookup took, e.g. `120ms`. */
  elapsed: string | null;
}

/** Structured payload attached to the MCP tool result (`structuredContent`). */
export const domainAvailabilityStructuredSchema = z.object({
  domain: z.string(),
  name: z.string(),
  tld: z.string(),
  available: z.boolean(),
  tldValid: z.boolean().nullable(),
  checkMethod: z.string().nullable(),
  elapsed: z.string().nullable(),
});
