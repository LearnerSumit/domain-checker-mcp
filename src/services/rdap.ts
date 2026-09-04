/**
 * The ONLY module that talks to RDAP.
 *
 * Responsibilities:
 *  - resolve the authoritative RDAP base URL for a TLD via the IANA bootstrap
 *    registry (`data.iana.org/rdap/dns.json`), cached in memory
 *  - query that registry's RDAP server for the domain (no user-controlled
 *    URLs -> no SSRF surface beyond what IANA itself publishes)
 *  - enforce a request timeout via AbortController
 *  - translate every failure mode into a safe {@link AppError}
 *
 * No credentials are required or sent: RDAP is a public, unauthenticated
 * protocol mandated by ICANN for gTLD registries.
 */

import { getConfig } from "../config.js";
import { logger } from "../utils/logger.js";
import {
  NetworkError,
  RateLimitError,
  TimeoutError,
  UnsupportedTldError,
  UpstreamAuthError,
  UpstreamResponseError,
  UpstreamServerError,
} from "../utils/errors.js";
import type { DomainAvailabilityResult } from "../types/domain.js";
import type { NormalizedDomain } from "../validation/domain.js";

export interface RdapDeps {
  /** Injectable for tests. Defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
}

export const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";

const BOOTSTRAP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface BootstrapRegistry {
  services: Array<[tlds: string[], rdapServers: string[]]>;
}

let bootstrapCache: { data: BootstrapRegistry; fetchedAt: number } | undefined;

/** Test helper — forces the next call to re-fetch the bootstrap registry. */
export function resetRdapBootstrapCache(): void {
  bootstrapCache = undefined;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      headers: { accept: "application/rdap+json" },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadBootstrap(
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<BootstrapRegistry> {
  const now = Date.now();
  if (bootstrapCache && now - bootstrapCache.fetchedAt < BOOTSTRAP_CACHE_TTL_MS) {
    return bootstrapCache.data;
  }

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, IANA_BOOTSTRAP_URL, timeoutMs);
  } catch (err) {
    if (bootstrapCache) return bootstrapCache.data;
    if (err instanceof Error && err.name === "AbortError") throw new TimeoutError();
    throw new NetworkError();
  }

  if (!response.ok) {
    if (bootstrapCache) return bootstrapCache.data;
    throw new UpstreamServerError(
      "Could not load the IANA RDAP bootstrap registry.",
      response.status,
    );
  }

  const data = (await response.json()) as BootstrapRegistry;
  bootstrapCache = { data, fetchedAt: now };
  return data;
}

/** Resolves the RDAP base URL for a TLD, e.g. `co.uk` -> the `uk` entry. */
function resolveRdapBase(bootstrap: BootstrapRegistry, tld: string): string | undefined {
  const key = tld.split(".").pop() ?? tld;
  for (const [tlds, servers] of bootstrap.services) {
    if (servers.length > 0 && tlds.includes(key)) {
      return servers[0];
    }
  }
  return undefined;
}

function buildDomainQueryUrl(base: string, domain: string): string {
  const withTrailingSlash = base.endsWith("/") ? base : `${base}/`;
  return new URL(`domain/${domain}`, withTrailingSlash).toString();
}

export async function checkDomainAvailability(
  input: NormalizedDomain,
  deps: RdapDeps = {},
): Promise<DomainAvailabilityResult> {
  const config = getConfig();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;

  logger.info("Domain availability request started", { domain: input.domain });

  const bootstrap = await loadBootstrap(fetchImpl, config.requestTimeoutMs);
  const rdapBase = resolveRdapBase(bootstrap, input.tld);
  if (!rdapBase) {
    logger.warn("No RDAP server registered for TLD", { tld: input.tld });
    throw new UnsupportedTldError(input.tld);
  }

  const url = buildDomainQueryUrl(rdapBase, input.domain);
  const startedAt = Date.now();

  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, url, config.requestTimeoutMs);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      logger.warn("Domain availability request timed out", {
        domain: input.domain,
        timeoutMs: config.requestTimeoutMs,
      });
      throw new TimeoutError();
    }
    logger.error("Domain availability request network error", { domain: input.domain });
    throw new NetworkError();
  }

  const durationMs = Date.now() - startedAt;

  // RDAP has no "available" field: a 404 means no registration record exists.
  if (response.status === 404) {
    logger.info("Domain availability request completed", {
      domain: input.domain,
      available: true,
      durationMs,
    });
    return {
      domain: input.domain,
      name: input.name,
      tld: input.tld,
      available: true,
      tldValid: true,
      checkMethod: "rdap",
      elapsed: `${durationMs}ms`,
    };
  }

  if (response.status === 401 || response.status === 403) {
    logger.error("RDAP server returned an authentication error", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamAuthError(undefined, response.status);
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    logger.warn("RDAP server returned 429", { domain: input.domain, retryAfter });
    throw new RateLimitError(
      retryAfter
        ? `The RDAP server is rate limiting requests. Please retry after ${retryAfter}s.`
        : undefined,
    );
  }

  if (response.status >= 500) {
    logger.error("RDAP server returned a server error", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamServerError(undefined, response.status);
  }

  if (!response.ok) {
    logger.error("RDAP server returned an unexpected status", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamResponseError(
      `The RDAP server returned an unexpected response (HTTP ${response.status}).`,
      response.status,
    );
  }

  try {
    await response.json();
  } catch {
    logger.error("RDAP server returned a non-JSON body", {
      domain: input.domain,
      status: response.status,
    });
    throw new UpstreamResponseError(
      "The RDAP server returned a response that could not be parsed.",
      response.status,
    );
  }

  // A 2xx body means the registry holds a registration record for this domain.
  logger.info("Domain availability request completed", {
    domain: input.domain,
    available: false,
    durationMs,
  });

  return {
    domain: input.domain,
    name: input.name,
    tld: input.tld,
    available: false,
    tldValid: true,
    checkMethod: "rdap",
    elapsed: `${durationMs}ms`,
  };
}
