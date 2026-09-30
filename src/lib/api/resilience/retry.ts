import { RetryBudget } from "./budget";
import { CircuitOpenError, RateLimitedError, TimeoutError } from "./errors";
import { apiHealth } from "./health";
import { parseRetryAfter } from "./retryAfter";
import { isAbortError, isIdempotent, originOf, sleep, type Middleware } from "./types";

export interface RetryOptions {
  /** Total attempts including the first (3 ⇒ up to 2 retries). */
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** A Retry-After longer than this is surfaced to the caller instead of waited out. */
  maxRetryAfterMs?: number;
  /** Budget factory, one per origin. */
  budget?: () => RetryBudget;
  random?: () => number;
  now?: () => number;
}

/** Statuses worth replaying for an idempotent request. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
/** Statuses whose Retry-After is recorded as a rate-limit window for the UI. */
const THROTTLE_STATUS = new Set([429, 503]);

/** Full-jitter exponential backoff: U(0, min(max, base·2^attempt)). */
export function backoffDelay(attempt: number, baseMs: number, maxMs: number, random: () => number): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.floor(random() * ceiling);
}

/**
 * Retry policy:
 *  - Only idempotent methods (GET/HEAD/OPTIONS) are retried. POST/DELETE are
 *    never replayed here — duplicate trades are worse than a visible error.
 *  - Retries on network errors, timeouts and 408/429/5xx (except 501).
 *  - 429/503 honour Retry-After (plus a little jitter so tabs don't sync up);
 *    windows longer than `maxRetryAfterMs` are returned to the caller.
 *  - Every retry spends from a per-origin RetryBudget.
 *  - Never retries caller aborts, open circuits or pre-emptive rate-limit rejections.
 */
export function withRetry(opts: RetryOptions = {}): Middleware {
  const {
    maxAttempts = 3,
    baseDelayMs = 300,
    maxDelayMs = 5_000,
    maxRetryAfterMs = 10_000,
    budget = () => new RetryBudget(),
    random = Math.random,
    now = Date.now,
  } = opts;
  const budgets = new Map<string, RetryBudget>();
  const budgetFor = (origin: string) => {
    let b = budgets.get(origin);
    if (!b) budgets.set(origin, (b = budget()));
    return b;
  };

  return (next) => async (req) => {
    const origin = originOf(req.url);
    const bucket = budgetFor(origin);
    bucket.deposit();
    const retryable = isIdempotent(req) && !req.noRetry;

    for (let attempt = 0; ; attempt++) {
      const canRetry = retryable && attempt + 1 < maxAttempts;
      let res: Response;
      try {
        res = await next(req);
      } catch (err) {
        if (isAbortError(err) || err instanceof CircuitOpenError || err instanceof RateLimitedError) throw err;
        const transient = err instanceof TimeoutError || err instanceof TypeError;
        if (!transient || !canRetry || !bucket.tryWithdraw()) throw err;
        await sleep(backoffDelay(attempt, baseDelayMs, maxDelayMs, random), req.signal);
        continue;
      }

      let retryAfterMs: number | null = null;
      if (THROTTLE_STATUS.has(res.status)) {
        retryAfterMs = parseRetryAfter(res.headers.get("retry-after"), now());
        // 429 without a hint still means "slow down": use the backoff ceiling.
        if (retryAfterMs === null && res.status === 429) retryAfterMs = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
        if (retryAfterMs !== null) apiHealth.setRateLimited(origin, now() + retryAfterMs);
      }

      if (!RETRYABLE_STATUS.has(res.status) || !canRetry) return res;
      if (retryAfterMs !== null && retryAfterMs > maxRetryAfterMs) return res;
      if (!bucket.tryWithdraw()) return res;

      const delay = retryAfterMs !== null
        ? retryAfterMs + Math.floor(random() * baseDelayMs)
        : backoffDelay(attempt, baseDelayMs, maxDelayMs, random);
      // Free the connection before sleeping; the body is never read.
      res.body?.cancel().catch(() => {});
      await sleep(delay, req.signal);
    }
  };
}
