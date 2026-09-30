/**
 * @jest-environment node
 *
 * End-to-end scenarios for the API client + resilience stack against an MSW
 * mock backend. Real timers with tiny delays (MSW schedules its own work).
 */
import { http, HttpResponse, delay } from "msw";
import { setupServer } from "msw/node";
import { apiGet, apiPost, ApiError, setApiTransport } from "../client";
import { apiHealth, createResilientFetch, IDEMPOTENCY_HEADER } from "../resilience";
import { env } from "../../../env";

const API = env.NEXT_PUBLIC_API_URL;
const hits: Record<string, number> = {};
const seenHeaders: Headers[] = [];
const count = (key: string) => (hits[key] = (hits[key] ?? 0) + 1);

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterAll(() => server.close());
beforeEach(() => {
  for (const k of Object.keys(hits)) delete hits[k];
  seenHeaders.length = 0;
  apiHealth.reset();
  setApiTransport(
    createResilientFetch({
      timeoutMs: 200,
      retry: { baseDelayMs: 5, maxDelayMs: 20, maxRetryAfterMs: 1000 },
      breaker: { failureThreshold: 3, cooldownMs: 60_000 },
    }),
  );
});
afterEach(() => server.resetHandlers());

async function caught(p: Promise<unknown>): Promise<ApiError> {
  const err = await p.then(() => null, (e) => e);
  expect(err).toBeInstanceOf(ApiError);
  return err as ApiError;
}

describe("scenario: transient 503 on a GET", () => {
  it("retries and succeeds transparently", async () => {
    server.use(
      http.get(`${API}/api/v1/flaky`, () =>
        count("flaky") === 1 ? new HttpResponse(null, { status: 503 }) : HttpResponse.json({ ok: true }),
      ),
    );
    await expect(apiGet("/api/v1/flaky")).resolves.toEqual({ ok: true });
    expect(hits.flaky).toBe(2);
  });
});

describe("scenario: 503 on a trade POST", () => {
  it("is never retried and carries the idempotency key", async () => {
    server.use(
      http.post(`${API}/api/v1/positions/open`, ({ request }) => {
        count("open");
        seenHeaders.push(request.headers);
        return HttpResponse.json({ error: "overloaded" }, { status: 503 });
      }),
    );
    const err = await caught(apiPost("/api/v1/positions/open", { contracts: 1 }, "tok", undefined, { idempotencyKey: "intent-1" }));
    expect(err.status).toBe(503);
    expect(hits.open).toBe(1);
    expect(seenHeaders[0].get(IDEMPOTENCY_HEADER)).toBe("intent-1");
  });
});

describe("scenario: 429 with a long Retry-After", () => {
  it("surfaces the rate-limited state and stops sending requests", async () => {
    server.use(
      http.get(`${API}/api/v1/chain`, () => {
        count("chain");
        return HttpResponse.json({ error: "slow down" }, { status: 429, headers: { "Retry-After": "30" } });
      }),
    );
    const first = await caught(apiGet("/api/v1/chain"));
    expect(first).toMatchObject({ status: 429, reason: "rate_limited" });
    expect(first.retryAfterMs).toBe(30_000);
    expect(apiHealth.get(new URL(API).origin).rateLimitedUntil).toBeGreaterThan(Date.now());

    const second = await caught(apiGet("/api/v1/chain"));
    expect(second).toMatchObject({ status: 429, reason: "rate_limited" });
    expect(hits.chain).toBe(1);
  });
});

describe("scenario: 429 with a short Retry-After", () => {
  it("waits it out and retries", async () => {
    server.use(
      http.get(`${API}/api/v1/alerts`, () =>
        count("alerts") === 1
          ? new HttpResponse(null, { status: 429, headers: { "Retry-After": "0" } })
          : HttpResponse.json([]),
      ),
    );
    await expect(apiGet("/api/v1/alerts")).resolves.toEqual([]);
    expect(hits.alerts).toBe(2);
  });
});

describe("scenario: identical concurrent GETs", () => {
  it("hit the backend once", async () => {
    server.use(
      http.get(`${API}/api/v1/account`, async () => {
        count("account");
        await delay(20);
        return HttpResponse.json({ balance: 1 });
      }),
    );
    const results = await Promise.all([apiGet("/api/v1/account", "t"), apiGet("/api/v1/account", "t"), apiGet("/api/v1/account", "t")]);
    expect(results).toEqual([{ balance: 1 }, { balance: 1 }, { balance: 1 }]);
    expect(hits.account).toBe(1);
  });

  it("are not shared between different tokens", async () => {
    server.use(http.get(`${API}/api/v1/account`, () => (count("account"), HttpResponse.json({}))));
    await Promise.all([apiGet("/api/v1/account", "alice"), apiGet("/api/v1/account", "bob")]);
    expect(hits.account).toBe(2);
  });
});

describe("scenario: sustained outage", () => {
  it("opens the circuit and fails fast without hitting the backend", async () => {
    server.use(http.get(`${API}/api/v1/down`, () => (count("down"), new HttpResponse(null, { status: 500 }))));
    await caught(apiGet("/api/v1/down")); // 3 attempts → threshold reached
    const before = hits.down;
    const err = await caught(apiGet("/api/v1/down"));
    expect(err).toMatchObject({ status: 503, reason: "circuit_open" });
    expect(hits.down).toBe(before);
    expect(apiHealth.get(new URL(API).origin).breaker).toBe("open");
  });
});

describe("scenario: slow backend", () => {
  it("times out and reports a timeout", async () => {
    server.use(
      http.get(`${API}/api/v1/slow`, async () => {
        await delay(1000);
        return HttpResponse.json({});
      }),
    );
    const err = await caught(apiGet("/api/v1/slow", null, undefined, { noRetry: true }));
    expect(err).toMatchObject({ status: 408, reason: "timeout" });
  });

  it("can be cancelled by the caller", async () => {
    server.use(
      http.get(`${API}/api/v1/slow`, async () => {
        await delay(1000);
        return HttpResponse.json({});
      }),
    );
    const ctrl = new AbortController();
    const p = apiGet("/api/v1/slow", null, undefined, { signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 10);
    await expect(p).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("scenario: hostile backend error strings", () => {
  it("strips control / bidi characters and caps the length", async () => {
    server.use(
      http.get(`${API}/api/v1/evil`, () =>
        HttpResponse.json({ error: "bad‮gnp.exe\u0000 request " + "x".repeat(1000) }, { status: 400 }),
      ),
    );
    const err = await caught(apiGet("/api/v1/evil"));
    expect(err.message).not.toMatch(/[‮\u0000]/);
    expect(err.message.startsWith("badgnp.exe request")).toBe(true);
    expect(Array.from(err.message).length).toBeLessThanOrEqual(300);
  });
});
