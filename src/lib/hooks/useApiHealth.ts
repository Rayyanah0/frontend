"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { apiHealth, type HealthSnapshot } from "../api/resilience";

export type ApiHealthStatus =
  | { kind: "ok" }
  | { kind: "rate_limited"; origin: string; retryInMs: number }
  | { kind: "degraded"; origin: string; probing: boolean; retryInMs: number };

const SERVER_SNAPSHOT: HealthSnapshot = { origins: {} };

/** Derive the single most important status to show (degraded beats rate-limited). */
export function summarizeHealth(snapshot: HealthSnapshot, now: number): ApiHealthStatus {
  let limited: ApiHealthStatus | null = null;
  for (const [origin, h] of Object.entries(snapshot.origins)) {
    if (h.breaker !== "closed") {
      return {
        kind: "degraded",
        origin,
        probing: h.breaker === "half-open",
        retryInMs: Math.max(0, (h.breakerRetryAt ?? now) - now),
      };
    }
    if (h.rateLimitedUntil !== null && h.rateLimitedUntil > now && !limited) {
      limited = { kind: "rate_limited", origin, retryInMs: h.rateLimitedUntil - now };
    }
  }
  return limited ?? { kind: "ok" };
}

/**
 * Live API health for degraded-mode UX. Re-renders on breaker / rate-limit
 * transitions and ticks once a second while a countdown is visible.
 */
export function useApiHealth(): ApiHealthStatus {
  const snapshot = useSyncExternalStore(apiHealth.subscribe, apiHealth.getSnapshot, () => SERVER_SNAPSHOT);
  const [now, setNow] = useState(() => Date.now());
  const status = summarizeHealth(snapshot, now);
  const counting = status.kind !== "ok";

  useEffect(() => {
    setNow(Date.now());
    if (!counting) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [counting, snapshot]);

  return status;
}
