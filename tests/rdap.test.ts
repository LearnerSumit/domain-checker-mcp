import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkDomainAvailability,
  IANA_BOOTSTRAP_URL,
  resetRdapBootstrapCache,
} from "../src/services/rdap.js";
import { normalizeAndValidateDomain } from "../src/validation/domain.js";
import {
  NetworkError,
  RateLimitError,
  TimeoutError,
  UnsupportedTldError,
  UpstreamAuthError,
  UpstreamResponseError,
  UpstreamServerError,
} from "../src/utils/errors.js";

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BOOTSTRAP = {
  services: [
    [["ai"], ["https://rdap.identitydigital.services/rdap/"]],
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["uk"], ["https://rdap.nominet.uk/uk/"]],
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch mock that answers the IANA bootstrap URL and delegates everything else. */
function mockFetch(domainHandler: FetchFn, bootstrapBody: unknown = BOOTSTRAP) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === IANA_BOOTSTRAP_URL) {
      return jsonResponse(bootstrapBody);
    }
    return domainHandler(url, init);
  });
}

beforeEach(() => {
  vi.stubEnv("LOG_LEVEL", "silent");
  resetRdapBootstrapCache();
});

afterEach(() => vi.unstubAllEnvs());

describe("checkDomainAvailability", () => {
  it("returns available=true on a 404 (no registration record)", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));

    const result = await checkDomainAvailability(input, { fetchImpl });

    expect(result).toEqual({
      domain: "perfectreview.ai",
      name: "perfectreview",
      tld: "ai",
      available: true,
      tldValid: true,
      checkMethod: "rdap",
      elapsed: expect.stringMatching(/^\d+ms$/),
    });
  });

  it("returns available=false on a 2xx with a registration record", async () => {
    const input = normalizeAndValidateDomain("google", "com");
    const fetchImpl = mockFetch(async () => jsonResponse({ objectClassName: "domain" }));

    const result = await checkDomainAvailability(input, { fetchImpl });

    expect(result).toEqual({
      domain: "google.com",
      name: "google",
      tld: "com",
      available: false,
      tldValid: true,
      checkMethod: "rdap",
      elapsed: expect.stringMatching(/^\d+ms$/),
    });
  });

  it("queries the RDAP base URL resolved from the bootstrap registry", async () => {
    const input = normalizeAndValidateDomain("google", "com");
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));

    await checkDomainAvailability(input, { fetchImpl });

    const domainCall = fetchImpl.mock.calls.find(([url]) => String(url) !== IANA_BOOTSTRAP_URL);
    expect(domainCall?.[0]).toBe("https://rdap.verisign.com/com/v1/domain/google.com");
  });

  it("resolves a multi-label TLD (co.uk) to its rightmost registered label", async () => {
    const input = normalizeAndValidateDomain("mybrand", "co.uk");
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));

    await checkDomainAvailability(input, { fetchImpl });

    const domainCall = fetchImpl.mock.calls.find(([url]) => String(url) !== IANA_BOOTSTRAP_URL);
    expect(domainCall?.[0]).toBe("https://rdap.nominet.uk/uk/domain/mybrand.co.uk");
  });

  it("throws UnsupportedTldError when no RDAP server is registered for the TLD", async () => {
    const input = normalizeAndValidateDomain("mybrand", "doesnotexist");
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));

    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UnsupportedTldError,
    );
    expect(fetchImpl.mock.calls.filter(([url]) => String(url) !== IANA_BOOTSTRAP_URL)).toHaveLength(0);
  });

  it("caches the bootstrap registry across multiple calls", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));

    await checkDomainAvailability(normalizeAndValidateDomain("a", "ai"), { fetchImpl });
    await checkDomainAvailability(normalizeAndValidateDomain("b", "com"), { fetchImpl });

    const bootstrapCalls = fetchImpl.mock.calls.filter(([url]) => String(url) === IANA_BOOTSTRAP_URL);
    expect(bootstrapCalls).toHaveLength(1);
  });

  it("maps HTTP 401 to UpstreamAuthError", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => new Response("nope", { status: 401 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamAuthError,
    );
  });

  it("maps HTTP 403 to UpstreamAuthError", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => new Response("forbidden", { status: 403 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamAuthError,
    );
  });

  it("maps HTTP 429 to RateLimitError and surfaces Retry-After when present", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(
      async () => new Response("slow down", { status: 429, headers: { "retry-after": "30" } }),
    );
    const err = await checkDomainAvailability(input, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.safeMessage).toContain("30s");
  });

  it("maps HTTP 500+ to UpstreamServerError", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => new Response("boom", { status: 503 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("maps other non-2xx statuses to UpstreamResponseError", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => new Response("bad", { status: 400 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("throws UpstreamResponseError when a 2xx body is not valid JSON", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(
      async () => new Response("<html>not json</html>", { status: 200, headers: { "content-type": "text/html" } }),
    );
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("throws TimeoutError when the domain query is aborted", async () => {
    vi.stubEnv("REQUEST_TIMEOUT_MS", "1000");
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const e = new Error("The operation was aborted");
            e.name = "AbortError";
            reject(e);
          });
        }),
    );
    await expect(
      checkDomainAvailability(input, { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it("maps generic network failures to NetworkError", async () => {
    const input = normalizeAndValidateDomain("perfectreview", "ai");
    const fetchImpl = mockFetch(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });
});
