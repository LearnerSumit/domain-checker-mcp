/**
 * Types for the RapidAPI "Domain Status" API and the cleaned result the MCP
 * tool returns.
 */

import { z } from "zod";

/**
 * Shape of a successful response from
 * `POST https://domainstatus.p.rapidapi.com/v1/domain/available`.
 *
 * Only `available` is treated as required; everything else is optional so a
 * minor upstream change does not break the tool. Unknown keys are preserved.
 */
export const rapidApiDomainResponseSchema = z
  .object({
    domain: z.string().optional(),
    name: z.string().optional(),
    tld: z.string().optional(),
    tld_valid: z.boolean().optional(),
    available: z.boolean(),
    check: z.string().optional(),
    time: z.string().optional(),
  })
  .loose();

export type RapidApiDomainResponse = z.infer<typeof rapidApiDomainResponseSchema>;

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
  /** Whether the upstream considered the TLD valid (null if not reported). */
  tldValid: boolean | null;
  /** Method the upstream used, e.g. `whois` or `dns` (null if not reported). */
  checkMethod: string | null;
  /** Upstream-reported latency string, e.g. `918ms` (null if not reported). */
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
