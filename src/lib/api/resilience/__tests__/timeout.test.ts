/** @jest-environment node */
import { TimeoutError } from "../errors";
import { withTimeout } from "../timeout";
import { compose, sleep, isAbortError } from "../types";
import { get, hangingFetcher, scriptedFetcher } from "../../../../test-utils/fetch";

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("withTimeout", () => {
  it("defaults to 10s and rejects with TimeoutError", async () => {
    const base = hangingFetcher();
    const f = withTimeout()(base);
    const p = f(get());
    const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
    await jest.advanceTimersByTimeAsync(9_999);
    expect(base.calls[0].init.signal?.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(base.calls[0].init.signal?.aborted).toBe(true);
  });

  it("honours a per-request timeout", async () => {
    const f = withTimeout()(hangingFetcher());
    const p = f(get(undefined, { timeoutMs: 500 }));
    const assertion = expect(p).rejects.toMatchObject({ name: "TimeoutError", timeoutMs: 500 });
    await jest.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it("propagates caller cancellation as AbortError, not TimeoutError", async () => {
    const ctrl = new AbortController();
    const f = withTimeout()(hangingFetcher());
    const p = f(get(undefined, { signal: ctrl.signal }));
    ctrl.abort();
    const err = await p.catch((e) => e);
    expect(isAbortError(err)).toBe(true);
    expect(err).not.toBeInstanceOf(TimeoutError);
  });

  it("rejects immediately when the caller signal is already aborted", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const base = scriptedFetcher([200]);
    await expect(withTimeout()(base)(get(undefined, { signal: ctrl.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(base.calls).toHaveLength(0);
  });

  it("clears the timer on success", async () => {
    const f = withTimeout(1000)(scriptedFetcher([200]));
    const res = await f(get());
    expect(res.status).toBe(200);
    expect(jest.getTimerCount()).toBe(0);
  });

  it("passes non-timeout errors through unchanged", async () => {
    const err = new TypeError("Failed to fetch");
    await expect(withTimeout()(scriptedFetcher([err]))(get())).rejects.toBe(err);
  });
});

describe("compose / sleep", () => {
  it("applies middleware outermost-first", async () => {
    const order: string[] = [];
    const tag = (name: string) => (next: (r: never) => Promise<Response>) => async (r: never) => {
      order.push(name);
      return next(r);
    };
    const f = compose(tag("a") as never, tag("b") as never)(scriptedFetcher([200]));
    await f(get());
    expect(order).toEqual(["a", "b"]);
  });

  it("sleep rejects when aborted mid-wait", async () => {
    const ctrl = new AbortController();
    const p = sleep(1000, ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });

  it("sleep rejects synchronously-aborted signals", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(sleep(1, ctrl.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
