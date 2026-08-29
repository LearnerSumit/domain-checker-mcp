/**
 * MCP tool: `check_domain_availability`
 *
 * The handler is deliberately thin: it delegates normalisation to
 * `validation/domain` and the network call to `services/rapidapi`, then formats
 * a clean, AI-friendly result. All errors are converted to safe messages.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/server";

import { normalizeAndValidateDomain } from "../validation/domain.js";
import { checkDomainAvailability, type RapidApiDeps } from "../services/rapidapi.js";
import { toAppError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import { getRateLimitConfig } from "../config.js";
import { clientKeyFromRequest, rateLimit } from "../utils/rateLimit.js";
import type { DomainAvailabilityResult } from "../types/domain.js";

export const TOOL_NAME = "check_domain_availability";

export const checkDomainAvailabilityInputSchema = z.object({
  name: z
    .string()
    .min(1)
    .describe(
      'The domain name without the TLD or a leading dot, e.g. "mybrand". Do not pass a full URL.',
    ),
  tld: z
    .string()
    .min(1)
    .describe('The top-level domain, e.g. "ai", "com", "io". A leading dot (".ai") is accepted.'),
});

export type CheckDomainAvailabilityInput = z.infer<typeof checkDomainAvailabilityInputSchema>;

/** Human-readable block shown to the model / user. */
export function formatResult(r: DomainAvailabilityResult): string {
  const lines = [
    `Domain: ${r.domain}`,
    `Status: ${r.available ? "AVAILABLE" : "NOT AVAILABLE"}`,
    `TLD Valid: ${r.tldValid === null ? "Unknown" : r.tldValid ? "Yes" : "No"}`,
    `Check Method: ${r.checkMethod ? r.checkMethod.toUpperCase() : "Unknown"}`,
  ];
  if (r.elapsed) {
    lines.push(`Lookup Time: ${r.elapsed}`);
  }
  return lines.join("\n");
}

/**
 * Core logic, decoupled from the MCP transport so it can be unit-tested and
 * reused. Throws {@link AppError} on any failure.
 */
export async function runCheckDomainAvailability(
  input: CheckDomainAvailabilityInput,
  deps?: RapidApiDeps,
): Promise<DomainAvailabilityResult> {
  const normalized = normalizeAndValidateDomain(input.name, input.tld);
  return checkDomainAvailability(normalized, deps);
}

export function registerCheckDomainAvailability(
  server: McpServer,
  deps?: RapidApiDeps,
): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: "Check domain availability",
      description:
        "Check whether a domain name is available for registration. Provide the name and TLD " +
        'separately (e.g. name "mybrand", tld "ai"). Returns availability, whether the ' +
        "TLD is valid, and which lookup method (usually WHOIS) was used.",
      inputSchema: checkDomainAvailabilityInputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async (args, ctx) => {
      const { max, windowMs } = getRateLimitConfig();
      const limit = rateLimit(clientKeyFromRequest(ctx?.http?.req), max, windowMs);
      if (!limit.ok) {
        logger.warn("check_domain_availability rate limited", {
          retryAfterSec: limit.retryAfterSec,
        });
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Rate limit reached for this client. Please wait ${limit.retryAfterSec}s and try again.`,
            },
          ],
        };
      }

      try {
        const result = await runCheckDomainAvailability(args, deps);
        return {
          content: [{ type: "text", text: formatResult(result) }],
          structuredContent: {
            domain: result.domain,
            name: result.name,
            tld: result.tld,
            available: result.available,
            tldValid: result.tldValid,
            checkMethod: result.checkMethod,
            elapsed: result.elapsed,
          },
        };
      } catch (err) {
        const appError = toAppError(err);
        logger.warn("check_domain_availability failed", { code: appError.code });
        return {
          isError: true,
          content: [{ type: "text", text: appError.safeMessage }],
        };
      }
    },
  );
}
