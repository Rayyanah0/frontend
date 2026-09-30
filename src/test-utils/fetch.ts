// Helpers for resilience-layer tests (not a test file: lives outside __tests__).
import type { ApiRequest, Fetcher } from "../lib/api/resilience";

export type Step = number | { status: number; headers?: Record<string, string>; body?: string } | Error;

/** A Fetcher that replays `steps` in order and records every request it saw. */
export function scriptedFetcher(steps: Step[]): Fetcher & { calls: ApiRequest[] } {
  const calls: ApiRequest[] = [];
  const queue = [...steps];
  const fn = (async (req: ApiRequest) => {
    calls.push(req);
    const step = queue.length > 1 ? queue.shift()! : queue[0];
    if (step instanceof Error) throw step;
    const spec = typeof step === "number" ? { status: step } : step;
    return new Response(spec.body ?? (spec.status === 204 ? null : JSON.stringify({ ok: spec.status < 400 })), {
      status: spec.status,
      headers: spec.headers,
    });
  }) as Fetcher & { calls: ApiRequest[] };
  fn.calls = calls;
  return fn;
}

/** A Fetcher that never resolves until the request's signal aborts. */
export function hangingFetcher(): Fetcher & { calls: ApiRequest[] } {
  const calls: ApiRequest[] = [];
  const fn = ((req: ApiRequest) => {
    calls.push(req);
    return new Promise<Response>((_, reject) => {
      const signal = req.init.signal ?? req.signal;
      signal?.addEventListener("abort", () => reject(signal.reason ?? new DOMException("Aborted", "AbortError")));
    });
  }) as Fetcher & { calls: ApiRequest[] };
  fn.calls = calls;
  return fn;
}

/** A Fetcher whose single response is released manually. */
export function deferredFetcher(): Fetcher & { calls: ApiRequest[]; resolve: (r: Response) => void; reject: (e: unknown) => void } {
  const calls: ApiRequest[] = [];
  let resolve!: (r: Response) => void;
  let reject!: (e: unknown) => void;
  const pending = new Promise<Response>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  const fn = ((req: ApiRequest) => {
    calls.push(req);
    const signal = req.signal;
    return new Promise<Response>((res, rej) => {
      pending.then(res, rej);
      signal?.addEventListener("abort", () => rej(signal.reason ?? new DOMException("Aborted", "AbortError")));
    });
  }) as Fetcher & { calls: ApiRequest[]; resolve: typeof resolve; reject: typeof reject };
  fn.calls = calls;
  fn.resolve = (r) => resolve(r);
  fn.reject = (e) => reject(e);
  return fn;
}

export const get = (url = "https://api.test/x", extra: Partial<ApiRequest> = {}): ApiRequest => ({
  url,
  init: { method: "GET", ...(extra.init ?? {}) },
  ...extra,
});

export const post = (url = "https://api.test/x", extra: Partial<ApiRequest> = {}): ApiRequest => ({
  url,
  init: { method: "POST", body: "{}", ...(extra.init ?? {}) },
  ...extra,
});
