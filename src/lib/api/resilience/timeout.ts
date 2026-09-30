import { TimeoutError } from "./errors";
import { abortReason, DEFAULT_TIMEOUT_MS, type Middleware } from "./types";

/**
 * Per-attempt timeout via AbortController, linked to the caller's signal.
 *  - timeout fires  → rejects with TimeoutError (retryable, counts as a breaker failure)
 *  - caller aborts  → rejects with the caller's AbortError (never retried)
 */
export function withTimeout(defaultTimeoutMs = DEFAULT_TIMEOUT_MS): Middleware {
  return (next) => async (req) => {
    const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
    const controller = new AbortController();
    const caller = req.signal;
    if (caller?.aborted) throw abortReason(caller);

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new TimeoutError(timeoutMs));
    }, timeoutMs);
    const onCallerAbort = () => controller.abort(abortReason(caller!));
    caller?.addEventListener("abort", onCallerAbort, { once: true });

    try {
      return await next({ ...req, init: { ...req.init, signal: controller.signal } });
    } catch (err) {
      if (timedOut) throw new TimeoutError(timeoutMs);
      throw err;
    } finally {
      clearTimeout(timer);
      caller?.removeEventListener("abort", onCallerAbort);
    }
  };
}
