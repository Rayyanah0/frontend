/**
 * @jest-environment node
 */
import { EMBED_ROUTE, buildCsp, buildSecurityConfig, cspHeaderName, generateNonce, securityHeaders, toOrigin } from "../csp";
import { normalizeReports } from "../cspReport";

const PROD = {
  NODE_ENV: "production",
  NEXT_PUBLIC_API_URL: "https://api.zenith.finance/base/path",
  NEXT_PUBLIC_STELLAR_NETWORK: "mainnet",
  CSP_MODE: "enforce",
};

const directive = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1).split(" ");

describe("buildSecurityConfig", () => {
  it("derives connect-src from the configured API, WS, RPC and Horizon origins", () => {
    const cfg = buildSecurityConfig(PROD);
    expect(cfg.connectSrc).toEqual(
      expect.arrayContaining(["https://api.zenith.finance", "wss://api.zenith.finance", "https://horizon.stellar.org"])
    );
    expect(cfg.connectSrc.some((o) => o.includes("/base"))).toBe(false); // origins only
    expect(cfg.mode).toBe("enforce");
    expect(cfg.hsts).toBe(true);
  });

  it("defaults to report-only", () => {
    expect(buildSecurityConfig({ ...PROD, CSP_MODE: undefined }).mode).toBe("report-only");
  });

  it("fails closed on invalid origins", () => {
    expect(() => buildSecurityConfig({ ...PROD, NEXT_PUBLIC_API_URL: "not a url" })).toThrow(/NEXT_PUBLIC_API_URL/);
    expect(() => buildSecurityConfig({ ...PROD, CSP_EXTRA_CONNECT_SRC: "javascript:alert(1)" })).toThrow(/protocol/);
    expect(() => toOrigin("https://user:pw@x.com", "X")).toThrow(/credentials/);
  });

  it("accepts extras", () => {
    const cfg = buildSecurityConfig({ ...PROD, CSP_EXTRA_CONNECT_SRC: "https://a.com, https://b.com/x", CSP_EXTRA_FRAME_SRC: "https://albedo.link", CSP_EMBED_ANCESTORS: "'self' https://partner.com" });
    expect(cfg.connectSrc).toEqual(expect.arrayContaining(["https://a.com", "https://b.com"]));
    expect(cfg.frameSrc).toEqual(["https://albedo.link"]);
    expect(cfg.embedAncestors).toEqual(["'self'", "https://partner.com"]);
  });
});

describe("buildCsp", () => {
  const cfg = buildSecurityConfig(PROD);
  const csp = buildCsp("abc123", cfg);

  it("uses a nonce + strict-dynamic and no unsafe-inline scripts", () => {
    const script = directive(csp, "script-src")!;
    expect(script).toEqual(expect.arrayContaining(["'nonce-abc123'", "'strict-dynamic'"]));
    expect(script).not.toContain("'unsafe-inline'");
    expect(script).not.toContain("'unsafe-eval'");
  });

  it("locks down the rest", () => {
    expect(directive(csp, "default-src")).toEqual(["'self'"]);
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "base-uri")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "report-uri")).toEqual(["/api/csp-report"]);
    expect(directive(csp, "connect-src")).toContain("wss://api.zenith.finance");
    expect(csp).toContain("upgrade-insecure-requests");
  });

  it("relaxes frame-ancestors only for embeds", () => {
    expect(directive(buildCsp("n", cfg, { embed: true }), "frame-ancestors")).toEqual(["'self'"]);
  });

  it("allows eval and localhost only in development", () => {
    const dev = buildCsp("n", buildSecurityConfig({ NODE_ENV: "development" }));
    expect(directive(dev, "script-src")).toContain("'unsafe-eval'");
    expect(directive(dev, "connect-src")).toContain("ws://localhost:*");
    expect(dev).not.toContain("upgrade-insecure-requests");
  });

  it("header name follows the rollout mode", () => {
    expect(cspHeaderName("report-only")).toBe("Content-Security-Policy-Report-Only");
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
  });

  it("nonces are unique base64", () => {
    const a = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(generateNonce()).not.toBe(a);
  });
});

describe("securityHeaders", () => {
  it("sets the full header set in production", () => {
    const h = securityHeaders(buildSecurityConfig(PROD));
    expect(h["Strict-Transport-Security"]).toBe("max-age=63072000; includeSubDomains; preload");
    expect(h["X-Content-Type-Options"]).toBe("nosniff");
    expect(h["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(h["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    expect(h["Permissions-Policy"]).toContain("camera=()");
    expect(h["X-Frame-Options"]).toBe("DENY");
  });

  it("omits HSTS in dev and X-Frame-Options on embeds", () => {
    expect(securityHeaders(buildSecurityConfig({ NODE_ENV: "development" }))["Strict-Transport-Security"]).toBeUndefined();
    expect(securityHeaders(buildSecurityConfig(PROD), { embed: true })["X-Frame-Options"]).toBeUndefined();
  });

  it("EMBED_ROUTE matches locale-prefixed embeds only", () => {
    expect(EMBED_ROUTE.test("/stats/embed")).toBe(true);
    expect(EMBED_ROUTE.test("/es/stats/embed")).toBe(true);
    expect(EMBED_ROUTE.test("/stats")).toBe(false);
    expect(EMBED_ROUTE.test("/stats/embedded")).toBe(false);
  });
});

describe("normalizeReports", () => {
  it("handles legacy report-uri bodies", () => {
    expect(normalizeReports({ "csp-report": { "document-uri": "https://x/a", "blocked-uri": "inline", "violated-directive": "script-src", "line-number": 3 } }))
      .toEqual([expect.objectContaining({ documentUri: "https://x/a", blockedUri: "inline", directive: "script-src", line: 3 })]);
  });

  it("handles Reporting API bodies and ignores other report types", () => {
    const out = normalizeReports([
      { type: "csp-violation", body: { documentURL: "https://x", blockedURL: "eval", effectiveDirective: "script-src", disposition: "report" } },
      { type: "deprecation", body: {} },
    ]);
    expect(out).toEqual([expect.objectContaining({ blockedUri: "eval", disposition: "report" })]);
  });

  it("returns [] for junk", () => {
    expect(normalizeReports(null)).toEqual([]);
    expect(normalizeReports({ foo: 1 })).toEqual([]);
  });
});
