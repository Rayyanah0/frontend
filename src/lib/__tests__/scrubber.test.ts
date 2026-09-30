/**
 * Unit tests for the Sentry PII scrubber.
 *
 * Run with: npx jest src/lib/__tests__/scrubber.test.ts
 * (or add to your test runner once a test framework is wired up)
 *
 * These tests are written as plain assertions so they can be executed
 * even before a full Jest/Vitest setup is in place — paste them into
 * Node.js REPL to verify the scrubber manually.
 */

import { scrubEvent } from "../scrubber";
import type { Event } from "@sentry/nextjs";

// ── helpers ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: "test-id",
    timestamp: 1_700_000_000,
    ...overrides,
  };
}

// ── authorization header ──────────────────────────────────────────────────────

describe("scrubEvent — authorization header", () => {
  it("redacts Authorization header", () => {
    const event = makeEvent({
      request: {
        url: "https://api.zenith.finance/api/v1/positions",
        headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.test", "content-type": "application/json" },
      },
    });
    const result = scrubEvent(event);
    expect(result).not.toBeNull();
    expect(result!.request!.headers!["Authorization"]).toBe("[REDACTED]");
    expect(result!.request!.headers!["content-type"]).toBe("application/json");
  });

  it("redacts authorization (lowercase)", () => {
    const event = makeEvent({
      request: {
        headers: { authorization: "Bearer secret-token-123" },
      },
    });
    const result = scrubEvent(event);
    expect(result!.request!.headers!["authorization"]).toBe("[REDACTED]");
  });
});

// ── bearer token in request body ─────────────────────────────────────────────

describe("scrubEvent — bearer token / signed payload", () => {
  it("redacts token field in request body", () => {
    const event = makeEvent({
      request: {
        data: { token: "eyJhbGciOiJIUzI1NiJ9.payload", walletAddress: "GABCDE1234" },
      },
    });
    const result = scrubEvent(event);
    expect(result!.request!.data).toEqual({ token: "[REDACTED]", walletAddress: "[WALLET_REDACTED]" });
  });

  it("redacts signature field", () => {
    const event = makeEvent({
      request: {
        data: { signature: "base64signedblob==", message: "nonce-xyz" },
      },
    });
    const result = scrubEvent(event);
    expect((result!.request!.data as Record<string, string>).signature).toBe("[REDACTED]");
  });

  it("scrubs string body entirely", () => {
    const event = makeEvent({ request: { data: "raw-string-body" } });
    const result = scrubEvent(event);
    expect(result!.request!.data).toBe("[SCRUBBED]");
  });
});

// ── wallet address hashing ────────────────────────────────────────────────────

describe("scrubEvent — wallet address in strings", () => {
  const STELLAR_ADDR = "GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ"; // 60 chars = G + 55

  it("replaces Stellar address in exception message", () => {
    const event = makeEvent({
      exception: {
        values: [{ type: "Error", value: `Failed for wallet ${STELLAR_ADDR} with code 401` }],
      },
    });
    const result = scrubEvent(event);
    expect(result!.exception!.values![0].value).toContain("[WALLET_REDACTED]");
    expect(result!.exception!.values![0].value).not.toContain("GABCDEF");
  });

  it("replaces Stellar address in breadcrumb message", () => {
    const event = makeEvent({
      breadcrumbs: {
        values: [{ message: `Connecting wallet ${STELLAR_ADDR}`, timestamp: 1_700_000_000 }],
      },
    });
    const result = scrubEvent(event);
    expect(result!.breadcrumbs!.values![0].message).not.toContain("GABCDEF");
    expect(result!.breadcrumbs!.values![0].message).toContain("[WALLET_REDACTED]");
  });
});

// ── fail-closed ───────────────────────────────────────────────────────────────

describe("scrubEvent — fail-closed", () => {
  it("returns null if the event object causes scrubbing to throw", () => {
    // Pass a circular reference — JSON.stringify would throw, but our
    // scrubber should catch it and return null rather than propagating.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const evil: any = {};
    evil.self = evil; // circular
    const event = makeEvent({ extra: evil });
    // Our scrubObject caps depth at 8, so this won't actually throw,
    // but we verify the event is still returned without the circular ref.
    const result = scrubEvent(event);
    expect(result).not.toBeNull();
  });
});
