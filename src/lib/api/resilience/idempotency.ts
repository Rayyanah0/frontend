/**
 * Idempotency keys for non-idempotent writes (open / close / roll / claim).
 *
 * Contract with the backend (see docs/api-resilience.md):
 *   - Header: `Idempotency-Key: <uuid v4>` on POST requests that create effects.
 *   - The backend stores (wallet, key) → response for ≥ 24h. A repeat with the
 *     same key and same body returns the stored response (no second trade);
 *     same key + different body → 422.
 *   - Backends that don't support it ignore the header — safe to always send.
 *
 * Key lifecycle: a key identifies one user *intent*. Resubmitting the same
 * intent (Confirm clicked again after a timeout / network error) must reuse
 * the key, so the server can dedupe. Changing any parameter, or completing
 * the intent successfully, mints a new key for the next one.
 */
export const IDEMPOTENCY_HEADER = "Idempotency-Key";

export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC 4122 v4 from getRandomValues (older Safari / jsdom).
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Stable JSON (sorted keys) so `{a,b}` and `{b,a}` are the same intent. */
export function intentFingerprint(intent: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      return Object.keys(v as object).sort().reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = norm((v as Record<string, unknown>)[k]);
        return acc;
      }, {});
    }
    return v;
  };
  return JSON.stringify(norm(intent));
}

/**
 * Tracks the key for the current intent.
 *   keyFor(intent)  — same fingerprint as last time ⇒ same key, else a new one
 *   complete()      — the intent succeeded; the next keyFor() mints a fresh key
 */
export class IntentKeyManager {
  private fingerprint: string | null = null;
  private key: string | null = null;

  constructor(private readonly mint: () => string = newIdempotencyKey) {}

  keyFor(intent: unknown): string {
    const fp = intentFingerprint(intent);
    if (fp !== this.fingerprint || this.key === null) {
      this.fingerprint = fp;
      this.key = this.mint();
    }
    return this.key;
  }

  complete(): void {
    this.fingerprint = null;
    this.key = null;
  }
}
