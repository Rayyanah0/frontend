/** @jest-environment node */
import { IntentKeyManager, intentFingerprint, newIdempotencyKey } from "../idempotency";

describe("newIdempotencyKey", () => {
  it("returns a v4 UUID", () => {
    expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("falls back to getRandomValues when randomUUID is missing", () => {
    const original = globalThis.crypto.randomUUID;
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined, configurable: true });
    try {
      expect(newIdempotencyKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      Object.defineProperty(globalThis.crypto, "randomUUID", { value: original, configurable: true });
    }
  });
});

describe("intentFingerprint", () => {
  it("is independent of key order", () => {
    expect(intentFingerprint({ a: 1, b: { c: 2, d: 3 } })).toBe(intentFingerprint({ b: { d: 3, c: 2 }, a: 1 }));
  });

  it("differs when any value differs", () => {
    expect(intentFingerprint({ contracts: 1 })).not.toBe(intentFingerprint({ contracts: 2 }));
  });
});

describe("IntentKeyManager", () => {
  let n = 0;
  const mint = () => `key-${++n}`;
  beforeEach(() => (n = 0));

  it("reuses the key for resubmits of the same intent", () => {
    const m = new IntentKeyManager(mint);
    const intent = { underlying: "XLM", strike: 0.12, contracts: 2 };
    expect(m.keyFor(intent)).toBe("key-1");
    expect(m.keyFor({ ...intent })).toBe("key-1");
  });

  it("mints a new key when the intent changes", () => {
    const m = new IntentKeyManager(mint);
    m.keyFor({ contracts: 1 });
    expect(m.keyFor({ contracts: 2 })).toBe("key-2");
  });

  it("changing back to an earlier intent is a new intent", () => {
    const m = new IntentKeyManager(mint);
    m.keyFor({ contracts: 1 });
    m.keyFor({ contracts: 2 });
    expect(m.keyFor({ contracts: 1 })).toBe("key-3");
  });

  it("mints a new key for the same params after completion", () => {
    const m = new IntentKeyManager(mint);
    m.keyFor({ contracts: 1 });
    m.complete();
    expect(m.keyFor({ contracts: 1 })).toBe("key-2");
  });
});
