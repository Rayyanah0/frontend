/** @jest-environment node */
import { RetryBudget } from "../budget";
import { CircuitOpenError, RateLimitedError, TimeoutError } from "../errors";
import { apiHealth } from "../health";
import { backoffDelay, withRetry, type RetryOptions } from "../retry";
import { get, post, scriptedFetcher, type Step } from "../../../../test-utils/fetch";

const ORIGIN = "https://api.test";

function setup(steps: Step[], opts: RetryOptions = {}) {
  const base = scriptedFetcher(steps);
  const f = withRetry({ random: () => 0.5, baseDelayMs: 100, maxDelayMs: 1000, ...opts })(base);
  return { base, f };
}

beforeEach(() => {
  jest.useFakeTimers();
  apiHealth.reset();
});
afterEach(() => jest.useRealTimers());

describe("backoffDelay", () => {
  it("is full-jitter exponential and capped", () => {
    expect(backoffDelay(0, 100, 1000, () => 0.999)).toBe(99);
    expect(backoffDelay(3, 100, 1000, () => 0.5)).toBe(400);
    expect(backoffDelay(10, 100, 1000, () => 0.999)).toBe(999);
    expect(backoffDelay(2, 100, 1000, () => 0)).toBe(0);
  });
});

describe("withRetry — idempotent GET", () => {
  it("retries a 503 and returns the eventual success", async () => {
    const { base, f } = setup([503, 200]);
    const p = f(get());
    await jest.advanceTimersByTimeAsync(50); // 0.5 * 100
    expect((await p).status).toBe(200);
    expect(base.calls).toHaveLength(2);
  });

  it.each([408, 500, 502, 504])("retries status %i", async (status) => {
    const { base, f } = setup([status, 200]);
    const p = f(get());
    await jest.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe(200);
    expect(base.calls).toHaveLength(2);
  });

  it.each([400, 401, 403, 404, 409, 422, 501])("does not retry status %i", async (status) => {
    const { base, f } = setup([status, 200]);
    expect((await f(get())).status).toBe(status);
    expect(base.calls).toHaveLength(1);
  });

  it("uses exponential delays between attempts", async () => {
    const { base, f } = setup([500, 500, 200], { maxAttempts: 3 });
    const p = f(get());
    await jest.advanceTimersByTimeAsync(49);
    expect(base.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1); // first delay 50
    expect(base.calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(99);
    expect(base.calls).toHaveLength(2);
    await jest.advanceTimersByTimeAsync(1); // second delay 100
    expect((await p).status).toBe(200);
  });

  it("stops after maxAttempts and returns the last response", async () => {
    const { base, f } = setup([500], { maxAttempts: 3 });
    const p = f(get());
    await jest.advanceTimersByTimeAsync(5000);
    expect((await p).status).toBe(500);
    expect(base.calls).toHaveLength(3);
  });

  it("retries network errors (TypeError) and timeouts", async () => {
    const { base, f } = setup([new TypeError("Failed to fetch"), new TimeoutError(10_000), 200]);
    const p = f(get());
    await jest.advanceTimersByTimeAsync(5000);
    expect((await p).status).toBe(200);
    expect(base.calls).toHaveLength(3);
  });

  it("rethrows the network error once attempts are exhausted", async () => {
    const err = new TypeError("Failed to fetch");
    const { f } = setup([err], { maxAttempts: 2 });
    const p = f(get());
    const assertion = expect(p).rejects.toBe(err);
    await jest.advanceTimersByTimeAsync(5000);
    await assertion;
  });

  it("never retries unknown errors", async () => {
    const err = new Error("boom");
    const { base, f } = setup([err, 200]);
    await expect(f(get())).rejects.toBe(err);
    expect(base.calls).toHaveLength(1);
  });

  it.each([
    ["CircuitOpenError", new CircuitOpenError(ORIGIN, 0)],
    ["RateLimitedError", new RateLimitedError(ORIGIN, 0)],
    ["AbortError", new DOMException("Aborted", "AbortError")],
  ])("never retries %s", async (_name, err) => {
    const { base, f } = setup([err, 200]);
    await expect(f(get())).rejects.toBe(err);
    expect(base.calls).toHaveLength(1);
  });

  it("respects noRetry", async () => {
    const { base, f } = setup([503, 200]);
    expect((await f(get(undefined, { noRetry: true }))).status).toBe(503);
    expect(base.calls).toHaveLength(1);
  });

  it("aborting during backoff rejects and makes no further attempts", async () => {
    const ctrl = new AbortController();
    const { base, f } = setup([503, 200]);
    const p = f(get(undefined, { signal: ctrl.signal }));
    await jest.advanceTimersByTimeAsync(10);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
    await jest.advanceTimersByTimeAsync(5000);
    expect(base.calls).toHaveLength(1);
  });
});

describe("withRetry — non-idempotent", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])("never retries %s on 503", async (method) => {
    const { base, f } = setup([503, 200]);
    const res = await f(post(undefined, { init: { method } }));
    expect(res.status).toBe(503);
    expect(base.calls).toHaveLength(1);
  });

  it("never retries a POST after a network error", async () => {
    const err = new TypeError("Failed to fetch");
    const { base, f } = setup([err, 200]);
    await expect(f(post())).rejects.toBe(err);
    expect(base.calls).toHaveLength(1);
  });

  it("still records a POST's Retry-After for the UI", async () => {
    const { f } = setup([{ status: 429, headers: { "retry-after": "7" } }]);
    await f(post());
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBe(Date.now() + 7000);
  });
});

describe("withRetry — 429 / 503 Retry-After", () => {
  it("waits exactly Retry-After (+ jitter) before retrying", async () => {
    const { base, f } = setup([{ status: 429, headers: { "retry-after": "2" } }, 200]);
    const p = f(get());
    await jest.advanceTimersByTimeAsync(2000 + 49);
    expect(base.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(1);
    expect((await p).status).toBe(200);
    expect(base.calls).toHaveLength(2);
  });

  it("parses an HTTP-date Retry-After on 503", async () => {
    const at = new Date(Date.now() + 3000).toUTCString();
    const { base, f } = setup([{ status: 503, headers: { "retry-after": at } }, 200]);
    const p = f(get());
    await jest.advanceTimersByTimeAsync(2000);
    expect(base.calls).toHaveLength(1);
    await jest.advanceTimersByTimeAsync(2000);
    expect((await p).status).toBe(200);
  });

  it("surfaces the response instead of waiting when Retry-After exceeds the max", async () => {
    const { base, f } = setup([{ status: 429, headers: { "retry-after": "60" } }, 200], { maxRetryAfterMs: 10_000 });
    const res = await f(get());
    expect(res.status).toBe(429);
    expect(base.calls).toHaveLength(1);
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBe(Date.now() + 60_000);
  });

  it("treats a hint-less 429 as a short rate-limit window", async () => {
    const { f } = setup([429, 200]);
    const p = f(get());
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBeNull();
    await jest.advanceTimersByTimeAsync(0);
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).not.toBeNull();
    await jest.advanceTimersByTimeAsync(1000);
    expect((await p).status).toBe(200);
  });

  it("does not mark a hint-less 503 as rate limited", async () => {
    const { f } = setup([503], { maxAttempts: 1 });
    await f(get());
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBeNull();
  });
});

describe("withRetry — budget", () => {
  it("stops retrying once the budget is drained", async () => {
    const { base, f } = setup([500], { maxAttempts: 5, budget: () => new RetryBudget({ reserve: 1, ratio: 0 }) });
    const p = f(get());
    await jest.advanceTimersByTimeAsync(10_000);
    expect((await p).status).toBe(500);
    expect(base.calls).toHaveLength(2); // original + 1 budgeted retry
  });

  it("budgets per origin", async () => {
    const { base, f } = setup([500], { maxAttempts: 2, budget: () => new RetryBudget({ reserve: 1, ratio: 0 }) });
    const a = f(get("https://a.test/x"));
    const b = f(get("https://b.test/x"));
    await jest.advanceTimersByTimeAsync(10_000);
    await Promise.all([a, b]);
    expect(base.calls).toHaveLength(4);
  });

  it("does not retry a network error without budget", async () => {
    const err = new TypeError("Failed to fetch");
    const { base, f } = setup([err, 200], { budget: () => new RetryBudget({ reserve: 0, ratio: 0 }) });
    await expect(f(get())).rejects.toBe(err);
    expect(base.calls).toHaveLength(1);
  });
});
