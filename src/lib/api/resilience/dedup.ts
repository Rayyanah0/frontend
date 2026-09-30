import { abortReason, methodOf, type ApiRequest, type Middleware } from "./types";

interface InFlight {
  promise: Promise<Response>;
  controller: AbortController;
  subscribers: number;
}

/** Same method + URL + Authorization ⇒ same request. Tokens differ per user, so never shared across sessions. */
export function dedupKey(req: ApiRequest): string {
  const auth = new Headers(req.init.headers).get("authorization") ?? "";
  return `${methodOf(req)} ${req.url} ${auth}`;
}

/**
 * Collapse identical in-flight GETs into one network request. Each caller
 * gets its own `Response.clone()`, so bodies can be read independently.
 *
 * Cancellation is reference-counted: a caller aborting only detaches that
 * caller (it rejects immediately); the shared fetch is aborted once every
 * subscriber has gone. Entries are dropped on settle, so a request issued
 * after the response arrives always hits the network (no caching here).
 */
export function withDedup(): Middleware & { inFlight: Map<string, InFlight> } {
  const inFlight = new Map<string, InFlight>();

  const mw: Middleware = (next) => (req) => {
    if (methodOf(req) !== "GET") return next(req);
    if (req.signal?.aborted) return Promise.reject(abortReason(req.signal));

    const key = dedupKey(req);
    let entry = inFlight.get(key);
    if (!entry) {
      const controller = new AbortController();
      const promise = next({ ...req, signal: controller.signal });
      const created: InFlight = { promise, controller, subscribers: 0 };
      entry = created;
      inFlight.set(key, created);
      promise.then(
        () => inFlight.get(key) === created && inFlight.delete(key),
        () => inFlight.get(key) === created && inFlight.delete(key),
      );
    }
    const shared = entry;
    shared.subscribers++;

    return new Promise<Response>((resolve, reject) => {
      let settled = false;
      const detach = () => {
        req.signal?.removeEventListener("abort", onAbort);
        if (--shared.subscribers === 0 && inFlight.get(key) === shared) {
          // Last interested caller left: cancel the network request too.
          inFlight.delete(key);
          shared.controller.abort(abortReason(req.signal!));
        }
      };
      const onAbort = () => {
        if (settled) return;
        settled = true;
        detach();
        reject(abortReason(req.signal!));
      };
      req.signal?.addEventListener("abort", onAbort, { once: true });

      shared.promise.then(
        (res) => {
          if (settled) return;
          settled = true;
          req.signal?.removeEventListener("abort", onAbort);
          shared.subscribers--;
          resolve(res.clone());
        },
        (err) => {
          if (settled) return;
          settled = true;
          req.signal?.removeEventListener("abort", onAbort);
          shared.subscribers--;
          reject(err);
        },
      );
    });
  };
  return Object.assign(mw, { inFlight });
}
