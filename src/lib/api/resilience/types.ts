// Shared types for the composable fetch middleware stack
// (withDedup → withRetry → withBreaker → withTimeout → fetch).

export interface ApiRequest {
  url: string;
  /** method / headers / body. `signal` here is ignored — use `signal` below. */
  init: RequestInit;
  /** Caller cancellation (e.g. TanStack Query's per-query AbortSignal). */
  signal?: AbortSignal;
  /** Per-attempt timeout. Defaults to DEFAULT_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Opt a request out of automatic retries even if it is idempotent. */
  noRetry?: boolean;
}

export type Fetcher = (req: ApiRequest) => Promise<Response>;
export type Middleware = (next: Fetcher) => Fetcher;

export const DEFAULT_TIMEOUT_MS = 10_000;

/** Methods safe to replay automatically (RFC 9110 §9.2.2). POST/PATCH never are. */
const IDEMPOTENT_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function methodOf(req: ApiRequest): string {
  return (req.init.method ?? "GET").toUpperCase();
}

export function isIdempotent(req: ApiRequest): boolean {
  return IDEMPOTENT_METHODS.has(methodOf(req));
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    // Relative URL (same-origin); bucket all of them together.
    return "self";
  }
}

export function compose(...middleware: Middleware[]): (base: Fetcher) => Fetcher {
  return (base) => middleware.reduceRight<Fetcher>((next, mw) => mw(next), base);
}

/** Abort-aware sleep. Rejects with the signal's reason if aborted mid-wait. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted.", "AbortError");
}

export function isAbortError(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === "AbortError";
}
