import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  clientKeyFromRequest,
  rateLimit,
  resetRateLimiter,
} from "../src/utils/rateLimit.js";
import { getRateLimitConfig } from "../src/config.js";

beforeEach(() => resetRateLimiter());
afterEach(() => vi.unstubAllEnvs());

describe("rateLimit", () => {
  it("allows up to `max` hits per window then blocks", () => {
    const key = "1.2.3.4";
    for (let i = 0; i < 3; i++) {
      expect(rateLimit(key, 3, 60_000, 1_000).ok).toBe(true);
    }
    const blocked = rateLimit(key, 3, 60_000, 1_000);
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it("resets after the window elapses", () => {
    const key = "1.2.3.4";
    rateLimit(key, 1, 10_000, 0);
    expect(rateLimit(key, 1, 10_000, 5_000).ok).toBe(false);
    expect(rateLimit(key, 1, 10_000, 10_001).ok).toBe(true);
  });

  it("tracks clients independently", () => {
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("b", 1, 60_000, 0).ok).toBe(true);
    expect(rateLimit("a", 1, 60_000, 0).ok).toBe(false);
  });

  it("is disabled when max <= 0", () => {
    for (let i = 0; i < 50; i++) {
      expect(rateLimit("x", 0, 60_000, 0).ok).toBe(true);
    }
  });
});

describe("clientKeyFromRequest", () => {
  it("uses the first hop of x-forwarded-for", () => {
    const req = new Request("http://x", { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" } });
    expect(clientKeyFromRequest(req)).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then a constant", () => {
    expect(
      clientKeyFromRequest(new Request("http://x", { headers: { "x-real-ip": "8.8.8.8" } })),
    ).toBe("8.8.8.8");
    expect(clientKeyFromRequest(new Request("http://x"))).toBe("unknown");
    expect(clientKeyFromRequest(undefined)).toBe("local");
  });
});

describe("getRateLimitConfig", () => {
  it("defaults to 15 per 60s", () => {
    expect(getRateLimitConfig()).toEqual({ max: 15, windowMs: 60_000 });
  });

  it("honours RATE_LIMIT_MAX=0 (disabled)", () => {
    vi.stubEnv("RATE_LIMIT_MAX", "0");
    expect(getRateLimitConfig().max).toBe(0);
  });

  it("clamps absurd values", () => {
    vi.stubEnv("RATE_LIMIT_WINDOW_MS", "50");
    expect(getRateLimitConfig().windowMs).toBe(1_000);
  });
});
