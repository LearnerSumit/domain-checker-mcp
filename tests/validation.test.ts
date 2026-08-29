import { describe, expect, it } from "vitest";

import { normalizeAndValidateDomain } from "../src/validation/domain.js";
import { ValidationError } from "../src/utils/errors.js";

describe("normalizeAndValidateDomain", () => {
  it("accepts a plain valid domain (perfectreview.ai)", () => {
    expect(normalizeAndValidateDomain("perfectreview", "ai")).toEqual({
      name: "perfectreview",
      tld: "ai",
      domain: "perfectreview.ai",
    });
  });

  it("accepts another valid domain (google.com)", () => {
    expect(normalizeAndValidateDomain("google", "com")).toEqual({
      name: "google",
      tld: "com",
      domain: "google.com",
    });
  });

  it("trims whitespace, lowercases, and strips a leading dot from the TLD", () => {
    expect(normalizeAndValidateDomain("  PerfectReview  ", ".AI")).toEqual({
      name: "perfectreview",
      tld: "ai",
      domain: "perfectreview.ai",
    });
  });

  it("de-duplicates a name that already contains the TLD", () => {
    expect(normalizeAndValidateDomain("perfectreview.ai", "ai")).toEqual({
      name: "perfectreview",
      tld: "ai",
      domain: "perfectreview.ai",
    });
  });

  it("supports multi-level TLDs (co.uk)", () => {
    expect(normalizeAndValidateDomain("example", "co.uk")).toEqual({
      name: "example",
      tld: "co.uk",
      domain: "example.co.uk",
    });
  });

  it("supports common TLDs generically", () => {
    for (const tld of ["com", "ai", "io", "co", "net", "org", "dev", "app"]) {
      expect(normalizeAndValidateDomain("brand", tld).tld).toBe(tld);
    }
  });

  it("rejects a name with a space (\"hello world\")", () => {
    expect(() => normalizeAndValidateDomain("hello world", "com")).toThrow(ValidationError);
  });

  it("rejects a full URL (https://perfectreview.ai)", () => {
    expect(() => normalizeAndValidateDomain("https://perfectreview.ai", "ai")).toThrow(
      ValidationError,
    );
  });

  it("rejects a name that contains a path", () => {
    expect(() => normalizeAndValidateDomain("perfectreview.ai/pricing", "ai")).toThrow(
      ValidationError,
    );
  });

  it("rejects invalid domain characters", () => {
    expect(() => normalizeAndValidateDomain("perfect_review", "ai")).toThrow(ValidationError);
    expect(() => normalizeAndValidateDomain("-perfectreview", "ai")).toThrow(ValidationError);
    expect(() => normalizeAndValidateDomain("perfectreview-", "ai")).toThrow(ValidationError);
  });

  it("rejects a missing name", () => {
    expect(() => normalizeAndValidateDomain("", "ai")).toThrow(/Domain name is required/);
    expect(() => normalizeAndValidateDomain("   ", "ai")).toThrow(/Domain name is required/);
  });

  it("rejects a missing TLD", () => {
    expect(() => normalizeAndValidateDomain("perfectreview", "")).toThrow(/TLD is required/);
    expect(() => normalizeAndValidateDomain("perfectreview", ".")).toThrow(/TLD/);
  });

  it("rejects a purely numeric TLD", () => {
    expect(() => normalizeAndValidateDomain("brand", "123")).toThrow(ValidationError);
  });

  it("rejects non-string input defensively", () => {
    expect(() => normalizeAndValidateDomain(undefined, "ai")).toThrow(ValidationError);
    expect(() => normalizeAndValidateDomain("brand", 42 as unknown as string)).toThrow(
      ValidationError,
    );
  });
});
