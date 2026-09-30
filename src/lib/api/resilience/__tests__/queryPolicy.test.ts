/** @jest-environment node */
import { ApiError } from "../../client";
import { isApiDegraded, pollInterval, shouldRetryQuery } from "../../queryPolicy";
import { summarizeHealth } from "../../../hooks/useApiHealth";
import { apiHealth } from "../health";

beforeEach(() => apiHealth.reset());

describe("shouldRetryQuery", () => {
  it("never re-retries ApiErrors (the client already did)", () => {
    expect(shouldRetryQuery(0, new ApiError(503, "x"))).toBe(false);
  });
  it("never retries aborts", () => {
    expect(shouldRetryQuery(0, new DOMException("a", "AbortError"))).toBe(false);
  });
  it("retries other errors once", () => {
    expect(shouldRetryQuery(0, new Error("rpc"))).toBe(true);
    expect(shouldRetryQuery(1, new Error("rpc"))).toBe(false);
  });
});

describe("degraded-mode helpers", () => {
  it("pollInterval backs off while degraded", () => {
    const interval = pollInterval(4000);
    expect(interval()).toBe(4000);
    apiHealth.setBreaker("https://api.test", "open", Date.now() + 1000);
    expect(isApiDegraded()).toBe(true);
    expect(interval()).toBe(32_000);
  });

  it("an expired rate-limit window is not degraded", () => {
    apiHealth.setRateLimited("https://api.test", 1000);
    expect(isApiDegraded(2000)).toBe(false);
    expect(isApiDegraded(500)).toBe(true);
  });

  it("summarizeHealth prefers degraded over rate-limited", () => {
    apiHealth.setRateLimited("https://a.test", 5000);
    expect(summarizeHealth(apiHealth.getSnapshot(), 1000)).toEqual({ kind: "rate_limited", origin: "https://a.test", retryInMs: 4000 });
    apiHealth.setBreaker("https://b.test", "half-open", null);
    expect(summarizeHealth(apiHealth.getSnapshot(), 1000)).toMatchObject({ kind: "degraded", probing: true });
  });

  it("summarizeHealth is ok when healthy", () => {
    expect(summarizeHealth(apiHealth.getSnapshot(), 0)).toEqual({ kind: "ok" });
  });
});
