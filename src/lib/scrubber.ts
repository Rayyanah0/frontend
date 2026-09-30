/**
 * PII scrubber for Sentry events — src/lib/scrubber.ts
 *
 * Used in the beforeSend / beforeSendTransaction hooks in sentry.*.config.ts.
 * All scrubbing logic lives here so it can be unit-tested in isolation.
 *
 * Rules:
 *  1. Remove the Authorization header (bearer token) from all requests.
 *  2. Remove any field whose key looks like a token/signature/secret.
 *  3. Hash wallet addresses (G… Stellar public keys) with a fixed salt so
 *     they are pseudonymous rather than identifiable.
 *
 * The scrubber is intentionally conservative — it returns null (drop the
 * event) rather than let potentially sensitive data through when scrubbing
 * itself fails.
 */

import type { Event } from "@sentry/nextjs";

/** Salt used when hashing wallet addresses.  Not a secret — just ensures
 *  two different deployments of Zenith produce different hashes for the
 *  same address, preventing cross-deployment correlation. */
const HASH_SALT = "zenith-v1";

/**
 * Deterministically hash a Stellar public key (G…) into a short hex
 * digest so it can be used as a pseudonymous Sentry user ID without
 * revealing the real address.
 *
 * Falls back to a fixed placeholder if the Web Crypto API is unavailable
 * (e.g. in old test environments) rather than throwing.
 */
export async function hashWalletAddress(address: string): Promise<string> {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    return "redacted-no-crypto";
  }
  const enc = new TextEncoder();
  const data = enc.encode(`${HASH_SALT}:${address}`);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16); // 16 hex chars is enough for pseudonymous dedup
}

// Keys that must be scrubbed if found anywhere in the event payload.
const SENSITIVE_KEY_PATTERNS = [
  /^authorization$/i,
  /^bearer$/i,
  /token/i,
  /secret/i,
  /password/i,
  /signature/i,
  /signed/i,
  /private.?key/i,
  /mnemonic/i,
  /seed/i,
];

// Stellar public key pattern: G followed by 55 base32 chars
const STELLAR_ADDRESS_RE = /G[A-Z2-7]{55}/g;

/**
 * Synchronously scrub a string value — replaces embedded wallet addresses
 * with [WALLET_HASH_REDACTED] (full async hash not possible here).
 */
function scrubString(value: string): string {
  return value.replace(STELLAR_ADDRESS_RE, "[WALLET_REDACTED]");
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

/**
 * Deep-scrub an arbitrary object, redacting sensitive keys and wallet
 * addresses in string values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scrubObject(obj: any, depth = 0): any {
  if (depth > 8) return "[MAX_DEPTH]";
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return scrubString(obj);
  if (typeof obj !== "object") return obj;

  if (Array.isArray(obj)) {
    return obj.map((item) => scrubObject(item, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = "[REDACTED]";
    } else {
      out[key] = scrubObject(value, depth + 1);
    }
  }
  return out;
}

/**
 * Sentry `beforeSend` hook.
 *
 * Pass this to `beforeSend` in sentry.client.config.ts.  Returns `null`
 * to drop the event if scrubbing itself throws (fail-closed).
 */
export function scrubEvent(event: Event): Event | null {
  try {
    // Scrub request headers — Authorization is the most critical.
    if (event.request?.headers) {
      const headers = { ...event.request.headers } as Record<string, string>;
      for (const key of Object.keys(headers)) {
        if (isSensitiveKey(key)) headers[key] = "[REDACTED]";
      }
      event.request = { ...event.request, headers };
    }

    // Scrub request body (may contain signed payloads).
    if (event.request?.data) {
      event.request = {
        ...event.request,
        data:
          typeof event.request.data === "string"
            ? "[SCRUBBED]"
            : scrubObject(event.request.data),
      };
    }

    // Scrub URL query params (unlikely to contain PII but defence-in-depth).
    if (event.request?.query_string) {
      event.request = {
        ...event.request,
        query_string:
          typeof event.request.query_string === "string"
            ? scrubString(event.request.query_string)
            : scrubObject(event.request.query_string),
      };
    }

    // Scrub extra / contexts objects.
    if (event.extra) event.extra = scrubObject(event.extra);
    if (event.contexts) event.contexts = scrubObject(event.contexts);

    // Scrub breadcrumb data.
    if (event.breadcrumbs?.values) {
      event.breadcrumbs = {
        ...event.breadcrumbs,
        values: event.breadcrumbs.values.map((b) => ({
          ...b,
          data: b.data ? scrubObject(b.data) : b.data,
          message: b.message ? scrubString(b.message) : b.message,
        })),
      };
    }

    // Scrub exception message text (wallet addresses sometimes leak here).
    if (event.exception?.values) {
      event.exception = {
        ...event.exception,
        values: event.exception.values.map((v) => ({
          ...v,
          value: v.value ? scrubString(v.value) : v.value,
        })),
      };
    }

    return event;
  } catch (err) {
    // If scrubbing itself throws, drop the event rather than risk leaking PII.
    console.error("[scrubEvent] scrubbing failed, dropping event:", err);
    return null;
  }
}
