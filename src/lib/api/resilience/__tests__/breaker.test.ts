/** @jest-environment node */
import { withBreaker, isBreakerFailureStatus } from "../breaker";
import { CircuitOpenError, RateLimitedError, TimeoutError } from "../errors";
import { apiHealth } from "../health";
import { get, post, scriptedFetcher, deferredFetcher, type Step } from "../../../../test-utils/fetch";

const ORIGIN = "https://api.test";

function setup(steps: Step[], threshold = 3) {
  const base = scriptedFetcher(steps);
  const mw = withBreaker({ failureThreshold: threshold, cooldownMs: 1000, maxCooldownMs: 4000 });
  return { base, f: mw(base), breakers: mw.breakers };
}

async function failTimes(f: (r: ReturnType<typeof get>) => Promise<Response>, n: number) {
  for (let i = 0; i < n; i++) await f(get()).catch(() => undefined);
}

beforeEach(() => {
  jest.useFakeTimers();
  apiHealth.reset();
});
afterEach(() => jest.useRealTimers());

describe("isBreakerFailureStatus", () => {
  it.each([[500, true], [502, true], [503, true], [504, true], [501, false], [429, false], [404, false], [200, false]])(
    "%i → %p",
    (status, expected) => expect(isBreakerFailureStatus(status)).toBe(expected),
  );
});

describe("withBreaker", () => {
  it("stays closed below the threshold", async () => {
    const { f, breakers } = setup([500], 3);
    await failTimes(f, 2);
    expect(breakers.get(ORIGIN)!.state).toBe("closed");
  });

  it("opens after N consecutive failures and fails fast without calling fetch", async () => {
    const { base, f, breakers } = setup([500], 3);
    await failTimes(f, 3);
    expect(breakers.get(ORIGIN)!.state).toBe("open");
    await expect(f(get())).rejects.toBeInstanceOf(CircuitOpenError);
    expect(base.calls).toHaveLength(3);
    expect(apiHealth.get(ORIGIN)).toMatchObject({ breaker: "open", breakerRetryAt: Date.now() + 1000 });
  });

  it("a success resets the consecutive-failure count", async () => {
    const { f, breakers } = setup([500, 500, 200, 500, 500], 3);
    await failTimes(f, 5);
    expect(breakers.get(ORIGIN)!.state).toBe("closed");
  });

  it("counts network errors and timeouts as failures", async () => {
    const { f, breakers } = setup([new TypeError("Failed to fetch"), new TimeoutError(10), new TypeError("x")], 3);
    await failTimes(f, 3);
    expect(breakers.get(ORIGIN)!.state).toBe("open");
  });

  it("treats 4xx, 429 and aborts as neutral", async () => {
    const { f, breakers } = setup([404, 429, new DOMException("a", "AbortError"), 422, 404], 2);
    await failTimes(f, 5);
    expect(breakers.get(ORIGIN)!.state).toBe("closed");
  });

  it("goes half-open after the cooldown and closes on a successful probe", async () => {
    const { f, breakers } = setup([500, 500, 500, 200], 3);
    await failTimes(f, 3);
    jest.advanceTimersByTime(1000);
    const res = await f(get());
    expect(res.status).toBe(200);
    expect(breakers.get(ORIGIN)!.state).toBe("closed");
    expect(apiHealth.get(ORIGIN).breaker).toBe("closed");
  });

  it("allows only one probe at a time while half-open", async () => {
    const base = deferredFetcher();
    const mw = withBreaker({ failureThreshold: 1, cooldownMs: 1000 });
    const f = mw(base);
    const first = f(get());
    base.reject(new TypeError("down"));
    await first.catch(() => undefined);
    expect(mw.breakers.get(ORIGIN)!.state).toBe("open");

    jest.advanceTimersByTime(1000);
    const probe2 = deferredFetcher();
    const f2 = mw(probe2);
    const probe = f2(get());
    expect(mw.breakers.get(ORIGIN)!.state).toBe("half-open");
    await expect(f2(get())).rejects.toBeInstanceOf(CircuitOpenError);
    probe2.resolve(new Response("{}", { status: 200 }));
    await probe;
    expect(mw.breakers.get(ORIGIN)!.state).toBe("closed");
  });

  it("re-opens with a doubled (capped) cooldown when the probe fails", async () => {
    const { f, breakers } = setup([500], 1);
    await failTimes(f, 1);
    const b = breakers.get(ORIGIN)!;

    jest.advanceTimersByTime(1000);
    await failTimes(f, 1); // probe fails → cooldown 2000
    expect(b.state).toBe("open");
    expect(b.retryAt - Date.now()).toBe(2000);

    jest.advanceTimersByTime(2000);
    await failTimes(f, 1); // → 4000
    jest.advanceTimersByTime(4000);
    await failTimes(f, 1); // capped at 4000
    expect(b.retryAt - Date.now()).toBe(4000);
  });

  it("an aborted probe returns to open without doubling the cooldown", async () => {
    const { f, breakers } = setup([500, new DOMException("a", "AbortError")], 1);
    await failTimes(f, 1);
    jest.advanceTimersByTime(1000);
    await failTimes(f, 1);
    const b = breakers.get(ORIGIN)!;
    expect(b.state).toBe("open");
    expect(b.retryAt - Date.now()).toBe(1000);
  });

  it("isolates breakers per origin", async () => {
    const { f, breakers } = setup([500], 1);
    await f(get("https://a.test/x"));
    expect(breakers.get("https://a.test")!.state).toBe("open");
    await expect(f(get("https://b.test/x"))).resolves.toBeDefined();
    expect(breakers.get("https://b.test")!.state).toBe("open"); // it also 500'd
    await expect(f(get("https://c.test/x"))).resolves.toBeDefined();
  });

  it("fails POSTs fast too (they are never sent while open)", async () => {
    const { base, f } = setup([500], 1);
    await failTimes(f, 1);
    await expect(f(post())).rejects.toBeInstanceOf(CircuitOpenError);
    expect(base.calls).toHaveLength(1);
  });

  it("enforces an active Retry-After window with RateLimitedError", async () => {
    const { base, f } = setup([200]);
    apiHealth.setRateLimited(ORIGIN, Date.now() + 5000);
    await expect(f(get())).rejects.toBeInstanceOf(RateLimitedError);
    expect(base.calls).toHaveLength(0);
    jest.advanceTimersByTime(5000);
    await expect(f(get())).resolves.toBeDefined();
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBeNull();
  });
});

describe("apiHealth", () => {
  it("does not shorten an existing rate-limit window", () => {
    apiHealth.setRateLimited(ORIGIN, 10_000);
    apiHealth.setRateLimited(ORIGIN, 5_000);
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBe(10_000);
    apiHealth.setRateLimited(ORIGIN, null);
    expect(apiHealth.get(ORIGIN).rateLimitedUntil).toBeNull();
  });

  it("notifies subscribers only on real changes", () => {
    const listener = jest.fn();
    const unsub = apiHealth.subscribe(listener);
    apiHealth.setBreaker(ORIGIN, "open", 1);
    apiHealth.setBreaker(ORIGIN, "open", 1);
    expect(listener).toHaveBeenCalledTimes(1);
    unsub();
    apiHealth.setBreaker(ORIGIN, "closed", null);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
