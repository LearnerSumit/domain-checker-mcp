import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { checkDomainAvailability } from "../src/services/rapidapi.js";
import { normalizeAndValidateDomain } from "../src/validation/domain.js";
import {
  ConfigurationError,
  NetworkError,
  RateLimitError,
  TimeoutError,
  UpstreamAuthError,
  UpstreamResponseError,
  UpstreamServerError,
} from "../src/utils/errors.js";

const input = normalizeAndValidateDomain("perfectreview", "ai");

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
const mockFetch = (impl: FetchFn) => vi.fn(impl);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const SUCCESS_BODY = {
  domain: "perfectreview.ai",
  name: "perfectreview",
  tld: "ai",
  tld_valid: true,
  available: true,
  check: "whois",
  time: "918ms",
  request: { name: "perfectreview", tld: "ai" },
};

beforeEach(() => {
  vi.stubEnv("RAPIDAPI_KEY", "test-secret-key");
  vi.stubEnv("LOG_LEVEL", "silent");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkDomainAvailability", () => {
  it("returns a clean structured result on success", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(SUCCESS_BODY));
    const result = await checkDomainAvailability(input, { fetchImpl });

    expect(result).toEqual({
      domain: "perfectreview.ai",
      name: "perfectreview",
      tld: "ai",
      available: true,
      tldValid: true,
      checkMethod: "whois",
      elapsed: "918ms",
    });
  });

  it("calls the configured RapidAPI endpoint with the right headers and body", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse(SUCCESS_BODY));
    await checkDomainAvailability(input, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://domainstatus.p.rapidapi.com/v1/domain/available");
    expect(init?.method).toBe("POST");
    const headers = init?.headers as Record<string, string>;
    expect(headers["x-rapidapi-host"]).toBe("domainstatus.p.rapidapi.com");
    expect(headers["x-rapidapi-key"]).toBe("test-secret-key");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "perfectreview", tld: "ai" });
  });

  it("throws ConfigurationError when RAPIDAPI_KEY is missing", async () => {
    vi.stubEnv("RAPIDAPI_KEY", "");
    const fetchImpl = vi.fn();
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      ConfigurationError,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps HTTP 401 to a safe UpstreamAuthError", async () => {
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 401 }));
    const err = await checkDomainAvailability(input, { fetchImpl }).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamAuthError);
    expect(err.safeMessage).not.toContain("test-secret-key");
  });

  it("maps HTTP 403 to UpstreamAuthError", async () => {
    const fetchImpl = vi.fn(async () => new Response("forbidden", { status: 403 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamAuthError,
    );
  });

  it("maps HTTP 429 to RateLimitError", async () => {
    const fetchImpl = vi.fn(async () => new Response("slow down", { status: 429 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });

  it("maps HTTP 500+ to UpstreamServerError", async () => {
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 503 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamServerError,
    );
  });

  it("maps other non-2xx statuses to UpstreamResponseError", async () => {
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 418 }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("throws UpstreamResponseError on invalid JSON", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response("<html>not json</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    );
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("throws UpstreamResponseError when the payload is missing `available`", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ domain: "perfectreview.ai" }));
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      UpstreamResponseError,
    );
  });

  it("throws TimeoutError when the request is aborted", async () => {
    vi.stubEnv("RAPIDAPI_TIMEOUT_MS", "1000");
    const fetchImpl = vi.fn(
      (_url: string | URL | Request, init?: RequestInit) =>
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
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(checkDomainAvailability(input, { fetchImpl })).rejects.toBeInstanceOf(
      NetworkError,
    );
  });

  it("never includes the API key in any thrown error message", async () => {
    const fetchImpl = vi.fn(async () => new Response("key=test-secret-key leaked", { status: 500 }));
    const err = await checkDomainAvailability(input, { fetchImpl }).catch((e) => e);
    expect(JSON.stringify(err)).not.toContain("test-secret-key");
    expect(err.safeMessage).not.toContain("test-secret-key");
  });
});
