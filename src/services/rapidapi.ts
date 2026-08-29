/**
 * The ONLY module that talks to RapidAPI.
 *
 * Responsibilities:
 *  - build the request to the single, hard-coded upstream endpoint (no
 *    user-controlled URLs -> no SSRF surface)
 *  - attach credentials from the environment (never logged, never returned)
 *  - enforce a request timeout via AbortController
 *  - translate every failure mode into a safe {@link AppError}
 *  - validate + shape the response
 */

import { getConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  NetworkError,
  RateLimitError,
  TimeoutError,
  UpstreamAuthError,
  UpstreamResponseError,
  UpstreamServerError,
  redactSecret,
} from "../utils/errors.js";
import {
  rapidApiDomainResponseSchema,
  type DomainAvailabilityResult,
  type RapidApiDomainResponse,
} from "../types/domain.js";
import type { NormalizedDomain } from "../validation/domain.js";

export interface RapidApiDeps {
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

function toResult(
  input: NormalizedDomain,
  data: RapidApiDomainResponse,
): DomainAvailabilityResult {
  return {
    domain: data.domain ?? input.domain,
    name: data.name ?? input.name,
    tld: data.tld ?? input.tld,
    available: data.available,
    tldValid: data.tld_valid ?? null,
    checkMethod: data.check ?? null,
    elapsed: data.time ?? null,
  };
}

export async function checkDomainAvailability(
  input: NormalizedDomain,
  deps: RapidApiDeps = {},
): Promise<DomainAvailabilityResult> {
  const config = getConfig(); // throws ConfigurationError if the key is missing
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const startedAt = Date.now();

  logger.info("Domain availability request started", { domain: input.domain });

  let response: Response;
  try {
    response = await fetchImpl(config.rapidApiUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-rapidapi-host": config.rapidApiHost,
        "x-rapidapi-key": config.rapidApiKey,
      },
      body: JSON.stringify({ name: input.name, tld: input.tld }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("Domain availability request timed out", {
        domain: input.domain,
        timeoutMs: config.requestTimeoutMs,
      });
      throw new TimeoutError();
    }
    logger.error("Domain availability request network error", {
      domain: input.domain,
    });
    throw new NetworkError();
  } finally {
    clearTimeout(timer);
  }

  const durationMs = Date.now() - startedAt;

  if (response.status === 401 || response.status === 403) {
    logger.error("RapidAPI returned an authentication error", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamAuthError(undefined, response.status);
  }

  if (response.status === 429) {
    logger.warn("RapidAPI returned 429", { domain: input.domain });
    throw new RateLimitError();
  }

  if (response.status >= 500) {
    logger.error("RapidAPI returned a server error", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamServerError(undefined, response.status);
  }

  if (!response.ok) {
    logger.error("RapidAPI returned an unexpected status", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamResponseError(
      `The domain availability service returned an unexpected response (HTTP ${response.status}).`,
      response.status,
    );
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    logger.error("RapidAPI returned a non-JSON body", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamResponseError(
      "The domain availability service returned a response that could not be parsed.",
      response.status,
    );
  }

  const parsed = rapidApiDomainResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.error("RapidAPI response failed schema validation", {
      domain: input.domain,
      issues: redactSecret(parsed.error.message, config.rapidApiKey).slice(0, 500),
    });
    throw new UpstreamResponseError(
      "The domain availability service returned data in an unexpected format.",
      response.status,
    );
  }

  const result = toResult(input, parsed.data);

  logger.info("Domain availability request completed", {
    domain: result.domain,
    available: result.available,
    durationMs,
  });

  return result;
}
