/** @jest-environment node */
import { dedupKey, withDedup } from "../dedup";
import { get, post, deferredFetcher, scriptedFetcher } from "../../../../test-utils/fetch";

const auth = (token: string) => ({ init: { method: "GET", headers: { authorization: `Bearer ${token}` } } });

describe("dedupKey", () => {
  it("includes method, URL and Authorization", () => {
    expect(dedupKey(get("https://api.test/a", auth("t1")))).toBe("GET https://api.test/a Bearer t1");
    expect(dedupKey(get("https://api.test/a"))).toBe("GET https://api.test/a ");
  });
});

describe("withDedup", () => {
  it("shares one network request between identical in-flight GETs", async () => {
    const base = deferredFetcher();
    const mw = withDedup();
    const f = mw(base);
    const a = f(get());
    const b = f(get());
    expect(base.calls).toHaveLength(1);
    base.resolve(new Response(JSON.stringify({ v: 1 }), { status: 200 }));
    const [ra, rb] = await Promise.all([a, b]);
    // Each caller can read its own body.
    expect(await ra.json()).toEqual({ v: 1 });
    expect(await rb.json()).toEqual({ v: 1 });
    expect(mw.inFlight.size).toBe(0);
  });

  it("does not share across different tokens", async () => {
    const base = scriptedFetcher([200]);
    const f = withDedup()(base);
    await Promise.all([f(get(undefined, auth("alice"))), f(get(undefined, auth("bob")))]);
    expect(base.calls).toHaveLength(2);
  });

  it("does not share across different URLs", async () => {
    const base = scriptedFetcher([200]);
    const f = withDedup()(base);
    await Promise.all([f(get("https://api.test/a")), f(get("https://api.test/b"))]);
    expect(base.calls).toHaveLength(2);
  });

  it("never dedupes POSTs", async () => {
    const base = scriptedFetcher([200]);
    const f = withDedup()(base);
    await Promise.all([f(post()), f(post())]);
    expect(base.calls).toHaveLength(2);
  });

  it("issues a fresh request once the previous one settled", async () => {
    const base = scriptedFetcher([200]);
    const f = withDedup()(base);
    await f(get());
    await f(get());
    expect(base.calls).toHaveLength(2);
  });

  it("shares rejections with every subscriber and then forgets them", async () => {
    const base = deferredFetcher();
    const mw = withDedup();
    const f = mw(base);
    const a = f(get());
    const b = f(get());
    const err = new TypeError("down");
    base.reject(err);
    await expect(a).rejects.toBe(err);
    await expect(b).rejects.toBe(err);
    expect(mw.inFlight.size).toBe(0);
  });

  it("one caller aborting does not cancel the shared request for others", async () => {
    const base = deferredFetcher();
    const f = withDedup()(base);
    const ctrl = new AbortController();
    const a = f(get(undefined, { signal: ctrl.signal }));
    const b = f(get());
    ctrl.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    expect(base.calls[0].signal!.aborted).toBe(false);
    base.resolve(new Response("{}", { status: 200 }));
    expect((await b).status).toBe(200);
  });

  it("aborts the shared request when every caller has aborted", async () => {
    const base = deferredFetcher();
    const mw = withDedup();
    const f = mw(base);
    const c1 = new AbortController();
    const c2 = new AbortController();
    const a = f(get(undefined, { signal: c1.signal }));
    const b = f(get(undefined, { signal: c2.signal }));
    c1.abort();
    c2.abort();
    await expect(a).rejects.toMatchObject({ name: "AbortError" });
    await expect(b).rejects.toMatchObject({ name: "AbortError" });
    expect(base.calls[0].signal!.aborted).toBe(true);
    expect(mw.inFlight.size).toBe(0);
  });

  it("a new caller after everyone aborted starts a new request", async () => {
    const base = deferredFetcher();
    const f = withDedup()(base);
    const c1 = new AbortController();
    const a = f(get(undefined, { signal: c1.signal }));
    c1.abort();
    await a.catch(() => undefined);
    void f(get()).catch(() => undefined);
    expect(base.calls).toHaveLength(2);
  });

  it("rejects immediately for an already-aborted signal", async () => {
    const base = scriptedFetcher([200]);
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(withDedup()(base)(get(undefined, { signal: ctrl.signal }))).rejects.toMatchObject({ name: "AbortError" });
    expect(base.calls).toHaveLength(0);
  });
});
