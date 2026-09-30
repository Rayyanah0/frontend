import { withBreaker, type BreakerOptions } from "./breaker";
import { withDedup } from "./dedup";
import { withRetry, type RetryOptions } from "./retry";
import { withTimeout } from "./timeout";
import { compose, DEFAULT_TIMEOUT_MS, type Fetcher } from "./types";

export * from "./types";
export * from "./errors";
export { apiHealth, type BreakerState, type HealthSnapshot, type OriginHealth } from "./health";
export { withTimeout } from "./timeout";
export { withRetry, backoffDelay, type RetryOptions } from "./retry";
export { withBreaker, CircuitBreaker, type BreakerOptions } from "./breaker";
export { withDedup, dedupKey } from "./dedup";
export { RetryBudget } from "./budget";
export { parseRetryAfter } from "./retryAfter";
export { IDEMPOTENCY_HEADER, IntentKeyManager, intentFingerprint, newIdempotencyKey } from "./idempotency";

export interface ResilientFetchOptions {
  retry?: RetryOptions;
  breaker?: BreakerOptions;
  timeoutMs?: number;
  /** Underlying transport; defaults to global fetch. */
  fetch?: typeof fetch;
}

/**
 * The standard stack. Order matters:
 *   dedup   — outermost, so N identical callers share one retry loop
 *   retry   — each attempt re-enters the breaker, so an opening circuit stops retries
 *   breaker — per attempt; also enforces Retry-After windows
 *   timeout — per attempt, linked to caller cancellation
 */
export function createResilientFetch(opts: ResilientFetchOptions = {}): Fetcher {
  const transport = opts.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const base: Fetcher = (req) => transport(req.url, req.init);
  return compose(
    withDedup(),
    withRetry(opts.retry),
    withBreaker(opts.breaker),
    withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  )(base);
}
