/**
 * Input normalisation + validation for the `check_domain_availability` tool.
 *
 * Guarantees before anything is sent upstream:
 *  - `name` and `tld` are non-empty strings
 *  - whitespace stripped, lower-cased
 *  - a full URL (`https://example.ai`, `example.ai/path`, ...) is rejected
 *  - a leading dot on the TLD (`.ai`) is normalised away
 *  - a redundant `name` that already includes the TLD (`perfectreview.ai` + `ai`)
 *    is de-duplicated
 *  - only valid DNS label characters remain
 *  - generic length limits (RFC 1035) are enforced — TLDs are NOT hard-coded
 */

import { ValidationError } from "../utils/errors.js";

export interface NormalizedDomain {
  /** Second-level name, e.g. `perfectreview` (may contain dots for sub-labels). */
  name: string;
  /** TLD without a leading dot, e.g. `ai` or `co.uk`. */
  tld: string;
  /** `${name}.${tld}` */
  domain: string;
}

/** A single DNS label: 1–63 chars, alphanumeric or hyphen, no leading/trailing hyphen. */
const LABEL_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Characters that indicate the caller passed a URL or path, not a bare name. */
const URL_LIKE_RE = /[\s/\\?#@:]/;

const MAX_DOMAIN_LENGTH = 253;

function requireString(value: unknown, field: "name" | "tld"): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(
      field === "name" ? "Domain name is required." : "TLD is required.",
    );
  }
  return value;
}

function assertLabels(value: string, kind: "name" | "tld"): void {
  const labels = value.split(".");
  for (const label of labels) {
    if (!LABEL_RE.test(label)) {
      throw new ValidationError(
        kind === "name"
          ? "Invalid domain name. Provide just the name (letters, digits and hyphens), e.g. \"perfectreview\" — not a URL."
          : "Invalid TLD. Use letters/digits only, e.g. \"ai\", \"com\" or \"co.uk\".",
      );
    }
  }
}

export function normalizeAndValidateDomain(
  rawName: unknown,
  rawTld: unknown,
): NormalizedDomain {
  const nameInput = requireString(rawName, "name");
  const tldInput = requireString(rawTld, "tld");

  let name = nameInput.trim().toLowerCase();
  let tld = tldInput.trim().toLowerCase();

  // Reject full URLs / paths / anything that is clearly not a bare name.
  if (URL_LIKE_RE.test(name) || name.includes("..")) {
    throw new ValidationError(
      "Invalid domain name. Pass only the domain name (e.g. \"perfectreview\"), not a URL such as \"https://perfectreview.ai\".",
    );
  }

  // Normalise the TLD: strip leading dot(s) and any stray dot padding.
  tld = tld.replace(/^\.+/, "").replace(/\.+$/, "");
  if (URL_LIKE_RE.test(tld) || tld.includes("..")) {
    throw new ValidationError(
      "Invalid TLD. Use letters/digits only, e.g. \"ai\", \"com\" or \"co.uk\".",
    );
  }

  // Trim a trailing dot and a redundant TLD suffix on the name:
  //   name="perfectreview.ai", tld="ai"  ->  name="perfectreview"
  name = name.replace(/\.+$/, "");
  if (tld && name.endsWith(`.${tld}`)) {
    name = name.slice(0, -1 * (tld.length + 1));
  }

  if (name === "") {
    throw new ValidationError("Domain name is required.");
  }
  if (tld === "") {
    throw new ValidationError("TLD is required.");
  }

  assertLabels(name, "name");
  assertLabels(tld, "tld");

  // The TLD must contain at least one letter (or be a punycode `xn--` label);
  // a purely numeric TLD is not registrable.
  if (!/[a-z]/.test(tld)) {
    throw new ValidationError(
      "Invalid TLD. Use letters/digits only, e.g. \"ai\", \"com\" or \"co.uk\".",
    );
  }

  const domain = `${name}.${tld}`;
  if (domain.length > MAX_DOMAIN_LENGTH) {
    throw new ValidationError("Invalid domain name. The domain is too long.");
  }

  return { name, tld, domain };
}
