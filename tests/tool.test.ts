import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";

import {
  checkDomainAvailabilityInputSchema,
  formatResult,
  registerCheckDomainAvailability,
  runCheckDomainAvailability,
  TOOL_NAME,
} from "../src/tools/domain.js";
import type { RapidApiDeps } from "../src/services/rapidapi.js";
import { resetRateLimiter } from "../src/utils/rateLimit.js";

type ToolHandler = (args: { name: string; tld: string }) => Promise<{
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  structuredContent?: Record<string, unknown>;
}>;

/** Registers the tool against a fake server and returns the captured handler + config. */
function captureTool(deps?: RapidApiDeps): { name: string; config: Record<string, unknown>; handler: ToolHandler } {
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
const mockFetch = (impl: FetchFn) => vi.fn(impl);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("RAPIDAPI_KEY", "unit-test-key");
  vi.stubEnv("LOG_LEVEL", "silent");
  resetRateLimiter();
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

  it("normalizes ' PerfectReview ' + '.AI' to perfectreview.ai before calling upstream", async () => {
    const fetchImpl = mockFetch(async () =>
      jsonResponse({ domain: "perfectreview.ai", available: true, tld_valid: true, check: "whois" }),
    );
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: " PerfectReview ", tld: ".AI" });

    const [, init] = fetchImpl.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ name: "perfectreview", tld: "ai" });
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

  it("returns a safe isError result when the key is not configured", async () => {
    vi.stubEnv("RAPIDAPI_KEY", "");
    const { handler } = captureTool({ fetchImpl: vi.fn() });
    const res = await handler({ name: "perfectreview", tld: "ai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toBe("RAPIDAPI_KEY is not configured.");
  });

  it("surfaces a clean auth error on upstream 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("unauthorized", { status: 401 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "perfectreview", tld: "ai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/credential/i);
    expect(res.content[0]!.text).not.toContain("unit-test-key");
  });

  it("enforces its own per-client rate limit before calling upstream", async () => {
    vi.stubEnv("RATE_LIMIT_MAX", "2");
    const fetchImpl = mockFetch(async () => jsonResponse({ domain: "x.ai", available: true }));
    const { handler } = captureTool({ fetchImpl });

    expect((await handler({ name: "a", tld: "ai" })).isError).toBeUndefined();
    expect((await handler({ name: "b", tld: "ai" })).isError).toBeUndefined();
    const third = await handler({ name: "c", tld: "ai" });
    expect(third.isError).toBe(true);
    expect(third.content[0]!.text).toMatch(/rate limit reached/i);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("surfaces a clean rate-limit error on upstream 429", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 429 }));
    const { handler } = captureTool({ fetchImpl });
    const res = await handler({ name: "perfectreview", tld: "ai" });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/rate limit/i);
  });
});

describe("runCheckDomainAvailability", () => {
  it("resolves an available domain (perfectreview.ai)", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ domain: "perfectreview.ai", available: true }));
    await expect(
      runCheckDomainAvailability({ name: "perfectreview", tld: "ai" }, { fetchImpl }),
    ).resolves.toMatchObject({ available: true });
  });

  it("resolves an unavailable domain (google.com)", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ domain: "google.com", available: false, tld_valid: true, check: "whois" }),
    );
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
        checkMethod: "whois",
        elapsed: "918ms",
      }),
    ).toBe(
      [
        "Domain: perfectreview.ai",
        "Status: AVAILABLE",
        "TLD Valid: Yes",
        "Check Method: WHOIS",
        "Lookup Time: 918ms",
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
