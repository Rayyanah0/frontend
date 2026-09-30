import { expect, test } from "@playwright/test";

// #117. The config's webServer runs `next start` with CSP_MODE=enforce by default.

const PAGES = ["/", "/options", "/portfolio", "/stats"];

for (const path of PAGES) {
  test(`security headers are present on ${path}`, async ({ request }) => {
    const res = await request.get(path);
    const h = res.headers();
    const csp = h["content-security-policy"] ?? h["content-security-policy-report-only"];
    expect(csp).toBeTruthy();
    expect(csp).toMatch(/script-src 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["permissions-policy"]).toContain("camera=()");
    expect(h["cross-origin-opener-policy"]).toBe("same-origin-allow-popups");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-powered-by"]).toBeUndefined();
  });
}

test("nonce is unique per request and applied to Next's scripts", async ({ page, request }) => {
  const a = (await request.get("/")).headers()["content-security-policy"];
  const b = (await request.get("/")).headers()["content-security-policy"];
  const nonceOf = (csp?: string) => /'nonce-([^']+)'/.exec(csp ?? "")?.[1];
  expect(nonceOf(a)).toBeTruthy();
  expect(nonceOf(a)).not.toBe(nonceOf(b));

  const violations: string[] = [];
  page.on("console", (m) => {
    if (/Content Security Policy/i.test(m.text())) violations.push(m.text());
  });
  const res = await page.goto("/");
  const nonce = nonceOf(res!.headers()["content-security-policy"]);
  const scriptNonces = await page.$$eval("script", (els) => els.map((e) => (e as HTMLScriptElement).nonce));
  expect(scriptNonces.length).toBeGreaterThan(0);
  expect(scriptNonces.every((n) => n === nonce)).toBe(true);
  await page.waitForLoadState("networkidle");
  expect(violations).toEqual([]); // the app itself runs clean under enforcement
});

test("an injected inline script is blocked", async ({ page }) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const w = window as unknown as { __injected?: boolean; __handler?: boolean };
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (e) => violations.push(e.violatedDirective));

    // 1. Inline <script> without the nonce (what an HTML-injection XSS produces).
    const s = document.createElement("script");
    s.textContent = "window.__injected = true";
    document.body.appendChild(s);

    // 2. Inline event handler.
    const holder = document.createElement("div");
    holder.innerHTML = `<img src="data:," onerror="window.__handler = true">`;
    document.body.appendChild(holder);

    await new Promise((r) => setTimeout(r, 250));
    return { injected: !!w.__injected, handler: !!w.__handler, violations };
  });
  expect(result.injected).toBe(false);
  expect(result.handler).toBe(false);
  expect(result.violations.some((d) => d.startsWith("script-src"))).toBe(true);
});

test("embed route may be framed; others may not", async ({ request }) => {
  const embed = (await request.get("/stats/embed")).headers();
  expect(embed["content-security-policy"]).not.toContain("frame-ancestors 'none'");
  expect(embed["x-frame-options"]).toBeUndefined();
});

test("CSP report endpoint accepts both report formats", async ({ request }) => {
  const legacy = await request.post("/api/csp-report", {
    headers: { "content-type": "application/csp-report" },
    data: JSON.stringify({ "csp-report": { "document-uri": "http://localhost/", "blocked-uri": "inline", "violated-directive": "script-src" } }),
  });
  expect(legacy.status()).toBe(204);
  const modern = await request.post("/api/csp-report", {
    headers: { "content-type": "application/reports+json" },
    data: JSON.stringify([{ type: "csp-violation", body: { documentURL: "http://localhost/", blockedURL: "eval", effectiveDirective: "script-src" } }]),
  });
  expect(modern.status()).toBe(204);
});
