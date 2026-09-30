// TanStack Query defaults that cooperate with the resilience stack in
// ./resilience instead of stacking a second retry loop on top of it.
import type { DefaultOptions } from "@tanstack/react-query";
import { ApiError } from "./client";
import { apiHealth } from "./resilience";

/**
 * API GETs are already retried (with budget + backoff) inside the client, so
 * the query layer does not retry ApiErrors again — that would multiply load
 * exactly when the backend is struggling. Non-API query functions (Soroban
 * RPC, Horizon) keep a single retry.
 */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError) return false;
  if ((error as { name?: string } | null)?.name === "AbortError") return false;
  return failureCount < 1;
}

/** True when any origin has an open/half-open breaker or an active Retry-After window. */
export function isApiDegraded(now = Date.now()): boolean {
  return Object.values(apiHealth.getSnapshot().origins).some(
    (o) => o.breaker !== "closed" || (o.rateLimitedUntil !== null && o.rateLimitedUntil > now),
  );
}

/**
 * Polling interval that backs off while the API is degraded, so every open
 * tab stops polling at full rate during an outage (the breaker already fails
 * these fast, but slower polling also keeps the UI calmer). Pass as
 * `refetchInterval: pollInterval(4000)`.
 */
export function pollInterval(baseMs: number, degradedMs = Math.max(baseMs * 8, 30_000)): () => number {
  return () => (isApiDegraded() ? degradedMs : baseMs);
}

export const queryClientDefaults: DefaultOptions = {
  queries: {
    staleTime: 2000,
    retry: shouldRetryQuery,
    refetchOnWindowFocus: false,
  },
  mutations: {
    // Writes are never retried automatically (duplicate trades). The user
    // re-confirms, and the idempotency key makes that resubmit safe.
    retry: false,
  },
};
