import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  checkDomainAvailabilityInputSchema,
  formatResult,
  registerCheckDomainAvailability,
  runCheckDomainAvailability,
  TOOL_NAME,
} from "../src/tools/domain.js";
import type { RdapDeps } from "../src/services/rdap.js";
import { IANA_BOOTSTRAP_URL, resetRdapBootstrapCache } from "../src/services/rdap.js";
import { resetRateLimiter } from "../src/utils/rateLimit.js";

type ToolHandler = (args: { name: string; tld: string }) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

/** Registers the tool against a fake server and returns the captured handler + config. */
function captureTool(deps?: RdapDeps): { name: string; config: Record<string, unknown>; handler: ToolHandler } {
  let captured: { name: string; config: Record<string, unknown>; handler: ToolHandler } | undefined;
  const fakeServer = {
    registerTool: (name: string, config: Record<string, unknown>, handler: ToolHandler) => {
      captured = { name, config, handler };
    },
  } as unknown as McpServer;

  registerCheckDomainAvailability(fakeServer, deps);
  if (!captured) throw new Error("tool was not registered");
  return captured;
}

type FetchFn = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

const BOOTSTRAP = {
  services: [
    [["ai"], ["https://rdap.identitydigital.services/rdap/"]],
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** A fetch mock that answers the IANA bootstrap URL and delegates domain queries. */
function mockFetch(domainHandler: FetchFn) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url) === IANA_BOOTSTRAP_URL) {
      return jsonResponse(BOOTSTRAP);
    }
    return domainHandler(url, init);
  });
}

beforeEach(() => {
  vi.stubEnv("LOG_LEVEL", "silent");
  resetRateLimiter();
  resetRdapBootstrapCache();
});
afterEach(() => vi.unstubAllEnvs());

describe("check_domain_availability tool", () => {
  it("registers under the expected name with a read-only annotation", () => {
    const { name, config } = captureTool();
    expect(name).toBe(TOOL_NAME);
    expect(name).toBe("check_domain_availability");
    expect(config.title).toBeTypeOf("string");
    expect((config.annotations as Record<string, unknown>).readOnlyHint).toBe(true);
  });

  it("exposes an input schema requiring name and tld as strings", () => {
    expect(checkDomainAvailabilityInputSchema.safeParse({ name: "x", tld: "ai" }).success).toBe(true);
    expect(checkDomainAvailabilityInputSchema.safeParse({ name: "x" }).success).toBe(false);
    expect(checkDomainAvailabilityInputSchema.safeParse({ name: "", tld: "ai" }).success).toBe(false);
    expect(checkDomainAvailabilityInputSchema.safeParse({ name: 1, tld: "ai" }).success).toBe(false);
  });

  it("normalizes ' PerfectReview ' + '.AI' to perfectreview.ai before querying RDAP", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: " PerfectReview ", tld: ".AI" });

    const domainCall = fetchImpl.mock.calls.find(([url]) => String(url) !== IANA_BOOTSTRAP_URL);
    expect(domainCall?.[0]).toBe("https://rdap.identitydigital.services/rdap/domain/perfectreview.ai");
    expect(res.isError).toBeUndefined();
    expect(res.content[0]!.text).toContain("perfectreview.ai");
    expect(res.structuredContent).toMatchObject({ domain: "perfectreview.ai", available: true });
  });

  it("returns an isError result (not a throw) for invalid input", async () => {
    const fetchImpl = vi.fn();
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "https://perfectreview.ai", tld: "ai" });

    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Invalid domain name/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("returns a safe isError result for an unsupported TLD", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "perfectreview", tld: "doesnotexist" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/no rdap server is registered/i);
  });

  it("surfaces a clean auth error on upstream 401", async () => {
    const fetchImpl = mockFetch(async () => new Response("unauthorized", { status: 401 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "perfectreview", tld: "ai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/rejected the request/i);
  });

  it("enforces its own per-client rate limit before calling upstream", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));
    const { handler } = captureTool({ fetchImpl });

    expect((await handler({ name: "a", tld: "ai" })).isError).toBeUndefined();
    expect((await handler({ name: "b", tld: "ai" })).isError).toBeUndefined();
    const third = await handler({ name: "c", tld: "ai" });
    expect(third.isError).toBe(true);
    expect(third.content[0]!.text).toMatch(/rate limit reached/i);
    expect(fetchImpl.mock.calls.filter(([url]) => String(url) !== IANA_BOOTSTRAP_URL)).toHaveLength(2);
  });

  it("surfaces a clean rate-limit error on upstream 429", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 429 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "perfectreview", tld: "ai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/rate limit/i);
  });
});

describe("runCheckDomainAvailability", () => {
  it("resolves an available domain (perfectreview.ai)", async () => {
    const fetchImpl = mockFetch(async () => new Response("", { status: 404 }));
    await expect(
      runCheckDomainAvailability({ name: "perfectreview", tld: "ai" }, { fetchImpl }),
    ).resolves.toMatchObject({ available: true });
  });

  it("resolves an unavailable domain (google.com)", async () => {
    const fetchImpl = mockFetch(async () => jsonResponse({ objectClassName: "domain" }));
    await expect(
      runCheckDomainAvailability({ name: "google", tld: "com" }, { fetchImpl }),
    ).resolves.toMatchObject({ available: false });
  });
});

describe("formatResult", () => {
  it("formats an available domain", () => {
    expect(
      formatResult({
        domain: "perfectreview.ai",
        name: "perfectreview",
        tld: "ai",
        available: true,
        tldValid: true,
        checkMethod: "rdap",
        elapsed: "42ms",
      }),
    ).toBe(
      [
        "Domain: perfectreview.ai",
        "Status: AVAILABLE",
        "TLD Valid: Yes",
        "Check Method: RDAP",
        "Lookup Time: 42ms",
      ].join("\n"),
    );
  });

  it("formats an unavailable domain with unknown fields", () => {
    expect(
      formatResult({
        domain: "example.com",
        name: "example",
        tld: "com",
        available: false,
        tldValid: null,
        checkMethod: null,
        elapsed: null,
      }),
    ).toBe(
      ["Domain: example.com", "Status: NOT AVAILABLE", "TLD Valid: Unknown", "Check Method: Unknown"].join(
        "\n",
      ),
    );
  });
});
