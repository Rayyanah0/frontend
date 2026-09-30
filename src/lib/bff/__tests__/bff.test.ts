/**
 * @jest-environment node
 *
 * BFF integration tests (#118): the route handlers are exercised with real
 * Request objects against a mocked upstream fetch.
 */

import { GET as sessionGET, POST as sessionPOST, DELETE as sessionDELETE } from "../../../app/api/bff/session/route";
import { GET as proxyGET, POST as proxyPOST, DELETE as proxyDELETE } from "../../../app/api/bff/[...path]/route";
import { checkAllowlist, isSafePath } from "../allowlist";
import { sealSession, unsealSession, tokenExpiry } from "../session";
import { CSRF_HEADER } from "../constants";
import { parseCookies } from "../handlers";

const ORIGIN = "http://localhost:3000";
const UPSTREAM = "http://backend.test";
const TOKEN = "header.eyJleHAiOjQxMDI0NDQ4MDB9.sig"; // exp = 2100-01-01
const WALLET = "GWALLETADDRESS";
const CSRF = "csrf-token-value";

const upstream = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();
const realFetch = global.fetch;

beforeAll(() => {
  process.env.BFF_UPSTREAM_URL = UPSTREAM;
  process.env.BFF_SESSION_SECRET = "x".repeat(48);
  global.fetch = upstream as unknown as typeof fetch;
});
afterAll(() => {
  global.fetch = realFetch;
});
beforeEach(() => upstream.mockReset());

// ── Helpers ───────────────────────────────────────────────────────────────────

async function sessionCookieValue(): Promise<string> {
  return sealSession({ t: TOKEN, a: WALLET, exp: Date.now() + 3_600_000 });
}

interface ReqOpts {
  method?: string;
  session?: boolean;
  csrfCookie?: string | null;
  csrfHeader?: string | null;
  origin?: string | null;
  secFetchSite?: string;
  body?: unknown;
  /** Use the production `__Host-` cookie names. */
  hostCookies?: boolean;
}

async function req(path: string, o: ReqOpts = {}): Promise<Request> {
  const headers = new Headers();
  const cookies: string[] = [];
  const prefix = o.hostCookies ? "__Host-" : "";
  if (o.session) cookies.push(`${prefix}zenith_session=${encodeURIComponent(await sessionCookieValue())}`);
  if (o.csrfCookie !== null) cookies.push(`${prefix}zenith_csrf=${o.csrfCookie ?? CSRF}`);
  if (cookies.length) headers.set("cookie", cookies.join("; "));
  if (o.csrfHeader !== null) headers.set(CSRF_HEADER, o.csrfHeader ?? CSRF);
  if (o.origin !== null) headers.set("origin", o.origin ?? ORIGIN);
  if (o.secFetchSite) headers.set("sec-fetch-site", o.secFetchSite);
  if (o.body !== undefined) headers.set("content-type", "application/json");
  return new Request(`${ORIGIN}${path}`, {
    method: o.method ?? "GET",
    headers,
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  });
}

const ctx = (path: string) => ({ params: Promise.resolve({ path: path.split("/").filter(Boolean) }) });
const proxied = (p: string) => `/api/bff${p}`;
const setCookies = (res: Response): string[] =>
  (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() ?? [res.headers.get("set-cookie") ?? ""];

const ok = (body: unknown = {}, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" }, ...init });

// ── Allowlist ─────────────────────────────────────────────────────────────────

describe("allowlist", () => {
  it.each([
    ["GET", "/api/v1/account", "required"],
    ["POST", "/api/v1/positions/open", "required"],
    ["POST", "/api/v1/positions/abc-123/close", "required"],
    ["GET", "/api/v1/market/XLM/iv-atm", "none"],
    ["POST", "/api/v1/auth/nonce", "none"],
    ["GET", "/community/strategies", "optional"],
  ])("allows %s %s (%s)", (method, path, auth) => {
    expect(checkAllowlist(method, path)).toEqual({ allowed: true, auth });
  });

  it.each([
    ["POST", "/api/v1/auth/verify"],
    ["GET", "/api/v1/auth/me"],
    ["GET", "/admin"],
    ["GET", "/api/v1/account/../admin"],
    ["GET", "/api/v1//account"],
    ["GET", "/api/v1/positions/%2e%2e/close"],
    ["GET", "/api/v1/market/XLM%2Fiv-atm"],
  ])("rejects %s %s with 404", (method, path) => {
    expect(checkAllowlist(method, path)).toEqual({ allowed: false, status: 404 });
  });

  it("rejects disallowed methods on known paths with 405", () => {
    expect(checkAllowlist("DELETE", "/api/v1/account")).toEqual({ allowed: false, status: 405 });
    expect(checkAllowlist("PUT", "/api/v1/watchlist")).toEqual({ allowed: false, status: 405 });
  });

  it("isSafePath", () => {
    expect(isSafePath("/api/v1/account")).toBe(true);
    expect(isSafePath("api/v1/account")).toBe(false);
    expect(isSafePath("/a\\b")).toBe(false);
    expect(isSafePath("/./a")).toBe(false);
  });
});

// ── Proxy ─────────────────────────────────────────────────────────────────────

describe("proxy", () => {
  it("404s non-allowlisted paths without calling the backend", async () => {
    const res = await proxyGET(await req(proxied("/api/v1/auth/me"), { session: true }), ctx("api/v1/auth/me"));
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("401s required-auth paths without a session, without calling the backend", async () => {
    const res = await proxyGET(await req(proxied("/api/v1/account")), ctx("api/v1/account"));
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("attaches the bearer token server-side and streams the response through", async () => {
    upstream.mockResolvedValueOnce(ok({ balance: 5 }, { headers: { "content-type": "application/json", "set-cookie": "evil=1" } }));
    const res = await proxyGET(await req(proxied("/api/v1/positions?status=open"), { session: true }), ctx("api/v1/positions"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ balance: 5 });

    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe(`${UPSTREAM}/api/v1/positions?status=open`);
    const sent = new Headers(init!.headers);
    expect(sent.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(sent.get("cookie")).toBeNull(); // browser cookies never reach the backend
    expect(res.headers.get("set-cookie")).toBeNull(); // backend cookies never reach the browser
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("server-timing")).toMatch(/upstream;dur=/);
  });

  it("never attaches the token to auth:none paths", async () => {
    upstream.mockResolvedValueOnce(ok({ iv: 0.5 }));
    await proxyGET(await req(proxied("/api/v1/market/XLM/iv-atm"), { session: true }), ctx("api/v1/market/XLM/iv-atm"));
    expect(new Headers(upstream.mock.calls[0][1]!.headers).get("authorization")).toBeNull();
  });

  it("clears the cookie when the backend rejects the token", async () => {
    upstream.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const res = await proxyGET(await req(proxied("/api/v1/account"), { session: true }), ctx("api/v1/account"));
    expect(res.status).toBe(401);
    expect(setCookies(res).join()).toMatch(/zenith_session=; .*Max-Age=0/);
  });

  describe("CSRF on mutating routes", () => {
    const post = (o: ReqOpts) => req(proxied("/api/v1/watchlist"), { method: "POST", session: true, body: { underlying: "XLM" }, ...o });

    it("accepts same-origin requests with a matching double-submit token", async () => {
      upstream.mockResolvedValueOnce(new Response(null, { status: 201 }));
      const res = await proxyPOST(await post({}), ctx("api/v1/watchlist"));
      expect(res.status).toBe(201);
    });

    it("rejects a cross-site Origin", async () => {
      const res = await proxyPOST(await post({ origin: "https://evil.example" }), ctx("api/v1/watchlist"));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "CSRF check failed (origin)" });
      expect(upstream).not.toHaveBeenCalled();
    });

    it("rejects a missing Origin unless Sec-Fetch-Site is same-origin", async () => {
      expect((await proxyPOST(await post({ origin: null }), ctx("api/v1/watchlist"))).status).toBe(403);
      upstream.mockResolvedValueOnce(new Response(null, { status: 201 }));
      expect((await proxyPOST(await post({ origin: null, secFetchSite: "same-origin" }), ctx("api/v1/watchlist"))).status).toBe(201);
    });

    it("rejects a missing or mismatched CSRF token", async () => {
      expect((await proxyPOST(await post({ csrfHeader: null }), ctx("api/v1/watchlist"))).status).toBe(403);
      expect((await proxyPOST(await post({ csrfHeader: "wrong" }), ctx("api/v1/watchlist"))).status).toBe(403);
      expect((await proxyPOST(await post({ csrfCookie: null }), ctx("api/v1/watchlist"))).status).toBe(403);
      expect((await proxyDELETE(await req(proxied("/api/v1/watchlist/XLM"), { method: "DELETE", session: true, csrfHeader: "x" }), ctx("api/v1/watchlist/XLM"))).status).toBe(403);
      expect(upstream).not.toHaveBeenCalled();
    });

    it("does not require CSRF for GET", async () => {
      upstream.mockResolvedValueOnce(ok([]));
      const res = await proxyGET(await req(proxied("/api/v1/watchlist"), { session: true, csrfHeader: null, origin: "https://evil.example" }), ctx("api/v1/watchlist"));
      expect(res.status).toBe(200);
    });
  });
});

// ── Session ───────────────────────────────────────────────────────────────────

describe("/api/bff/session", () => {
  const signIn = () =>
    req("/api/bff/session", { method: "POST", body: { wallet_address: WALLET, message: "m", signature: "s" } });

  it("sets an httpOnly, SameSite=Strict session cookie and never returns the token", async () => {
    upstream.mockResolvedValueOnce(ok({ token: TOKEN, wallet_address: WALLET }));
    const res = await sessionPOST(await signIn());
    expect(res.status).toBe(200);

    const text = await res.text();
    expect(text).not.toContain(TOKEN);
    expect(JSON.parse(text)).toEqual({ authenticated: true, wallet_address: WALLET, expires_at: tokenExpiry(TOKEN) });

    const cookies = setCookies(res);
    const session = cookies.find((c) => c.startsWith("zenith_session="))!;
    expect(session).toMatch(/HttpOnly/);
    expect(session).toMatch(/SameSite=Strict/);
    expect(session).toMatch(/Path=\//);
    expect(session).not.toContain(TOKEN); // encrypted, not just encoded
    const sealed = decodeURIComponent(session.split(";")[0].split("=")[1]);
    expect(await unsealSession(sealed)).toMatchObject({ t: TOKEN, a: WALLET });

    const csrf = cookies.find((c) => c.startsWith("zenith_csrf="))!;
    expect(csrf).not.toMatch(/HttpOnly/); // double-submit cookie is JS-readable by design
    expect(csrf).toMatch(/SameSite=Strict/);
  });

  it("uses Secure __Host- cookies in production", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      upstream.mockResolvedValueOnce(ok({ token: TOKEN, wallet_address: WALLET }));
      const res = await sessionPOST(
        await req("/api/bff/session", { method: "POST", hostCookies: true, body: { wallet_address: WALLET, message: "m", signature: "s" } })
      );
      const session = setCookies(res).find((c) => c.startsWith("__Host-zenith_session="))!;
      expect(session).toMatch(/Secure/);
      expect(session).toMatch(/HttpOnly/);
    } finally {
      env.NODE_ENV = prev;
    }
  });

  it("rejects sign-in without CSRF", async () => {
    const res = await sessionPOST(await req("/api/bff/session", { method: "POST", csrfHeader: null, body: {} }));
    expect(res.status).toBe(403);
  });

  it("rejects a verify response for a different wallet", async () => {
    upstream.mockResolvedValueOnce(ok({ token: TOKEN, wallet_address: "GOTHER" }));
    expect((await sessionPOST(await signIn())).status).toBe(502);
  });

  it("passes backend verify errors through without setting cookies", async () => {
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ error: "bad signature" }), { status: 401 }));
    const res = await sessionPOST(await signIn());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "bad signature" });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("GET mints a CSRF cookie and reports signed-out without a session", async () => {
    const res = await sessionGET(await req("/api/bff/session", { csrfCookie: null }));
    expect(await res.json()).toEqual({ authenticated: false, wallet_address: null, expires_at: null });
    expect(setCookies(res).some((c) => c.startsWith("zenith_csrf="))).toBe(true);
  });

  it("GET validates the session with the backend and clears it on 401", async () => {
    upstream.mockResolvedValueOnce(ok({ wallet_address: WALLET }));
    expect(await (await sessionGET(await req("/api/bff/session", { session: true }))).json()).toMatchObject({ authenticated: true, wallet_address: WALLET });

    upstream.mockResolvedValueOnce(new Response("{}", { status: 401 }));
    const res = await sessionGET(await req("/api/bff/session", { session: true }));
    expect((await res.json()).authenticated).toBe(false);
    expect(setCookies(res).join()).toMatch(/zenith_session=; .*Max-Age=0/);
  });

  it("GET treats a tampered cookie as signed out", async () => {
    const r = new Request(`${ORIGIN}/api/bff/session`, { headers: { cookie: "zenith_session=v1.AAAA.BBBB; zenith_csrf=x" } });
    expect((await (await sessionGET(r)).json()).authenticated).toBe(false);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("DELETE clears the session (CSRF-protected)", async () => {
    expect((await sessionDELETE(await req("/api/bff/session", { method: "DELETE", session: true, origin: "https://evil.example" }))).status).toBe(403);
    const res = await sessionDELETE(await req("/api/bff/session", { method: "DELETE", session: true }));
    expect(res.status).toBe(200);
    expect(setCookies(res).join()).toMatch(/zenith_session=; .*Max-Age=0/);
  });
});

describe("session sealing", () => {
  it("rejects expired, foreign-key, and malformed values", async () => {
    const sealed = await sealSession({ t: TOKEN, a: WALLET, exp: 1000 }, "k".repeat(32));
    expect(await unsealSession(sealed, "k".repeat(32), 500)).toMatchObject({ a: WALLET });
    expect(await unsealSession(sealed, "k".repeat(32), 2000)).toBeNull();
    expect(await unsealSession(sealed, "z".repeat(32), 500)).toBeNull();
    expect(await unsealSession("garbage", "k".repeat(32))).toBeNull();
  });

  it("parseCookies keeps the first occurrence", () => {
    expect(parseCookies("a=1; b=2; a=3")).toEqual({ a: "1", b: "2" });
  });
});
