// Per-origin API health, shared by the breaker / rate-limit middleware and
// read by the degraded-mode UI (useApiHealth + ApiHealthBanner). Framework
// agnostic: React subscribes through useSyncExternalStore.

export type BreakerState = "closed" | "open" | "half-open";

export interface OriginHealth {
  breaker: BreakerState;
  /** Epoch ms when an open breaker will allow a half-open probe. */
  breakerRetryAt: number | null;
  /** Epoch ms until which the server asked us to back off (Retry-After). */
  rateLimitedUntil: number | null;
}

export interface HealthSnapshot {
  origins: Readonly<Record<string, OriginHealth>>;
}

const HEALTHY: OriginHealth = { breaker: "closed", breakerRetryAt: null, rateLimitedUntil: null };

let snapshot: HealthSnapshot = { origins: {} };
const listeners = new Set<() => void>();

function patch(origin: string, next: Partial<OriginHealth>) {
  const prev = snapshot.origins[origin] ?? HEALTHY;
  const merged = { ...prev, ...next };
  if (
    merged.breaker === prev.breaker &&
    merged.breakerRetryAt === prev.breakerRetryAt &&
    merged.rateLimitedUntil === prev.rateLimitedUntil
  ) return;
  // New object identity on every change so useSyncExternalStore re-renders.
  snapshot = { origins: { ...snapshot.origins, [origin]: merged } };
  listeners.forEach((l) => l());
}

export const apiHealth = {
  get(origin: string): OriginHealth {
    return snapshot.origins[origin] ?? HEALTHY;
  },
  setBreaker(origin: string, breaker: BreakerState, breakerRetryAt: number | null) {
    patch(origin, { breaker, breakerRetryAt });
  },
  setRateLimited(origin: string, until: number | null) {
    const current = snapshot.origins[origin]?.rateLimitedUntil ?? null;
    // Never shorten an existing window because a later, shorter hint arrived.
    if (until !== null && current !== null && current > until) return;
    patch(origin, { rateLimitedUntil: until });
  },
  getSnapshot(): HealthSnapshot {
    return snapshot;
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Test helper. */
  reset() {
    snapshot = { origins: {} };
    listeners.forEach((l) => l());
  },
};
