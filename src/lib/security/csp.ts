/**
 * Content Security Policy and security headers (#117).
 *
 * This module is pure and Edge-safe, so middleware can use it and unit tests
 * can cover it. CSP origins come from the same validated config the app uses
 * to reach its API, WebSocket, Soroban RPC, and Horizon endpoints, which
 * means the policy can't drift from where the app actually connects.
 *
 * Policy summary:
 *   default-src 'self'
 *   script-src  'nonce-…' 'strict-dynamic'      (nonce per request)
 *   style-src   'self' 'unsafe-inline'          (React style={} attributes; see docs/security-headers.md)
 *   connect-src 'self' <api> <ws> <rpc> <horizon> [extras]
 *   frame-ancestors 'none'                       (except /stats/embed)
 *   object-src 'none'; base-uri 'none'; form-action 'self'
 */

import { NETWORKS, type SorobanNetwork } from "../soroban/networks";

export type CspMode = "report-only" | "enforce";

export interface SecurityConfig {
  mode: CspMode;
  dev: boolean;
  /** Origins allowed in connect-src (http(s) and ws(s)). */
  connectSrc: string[];
  /** Extra origins allowed in frame-src (wallet popups/iframes). */
  frameSrc: string[];
  /** frame-ancestors for the embeddable routes. */
  embedAncestors: string[];
  /** Same-origin path that receives violation reports. */
  reportPath: string;
  /** Emit HSTS (production over HTTPS). */
  hsts: boolean;
}

export const CSP_REPORT_PATH = "/api/csp-report";

/** Routes that may be framed by third parties (optionally locale-prefixed). */
export const EMBED_ROUTE = /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/stats\/embed(?:\/|$)/;

// ── Validation ────────────────────────────────────────────────────────────────

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "ws:", "wss:"]);

/**
 * Parses a configured URL down to its origin. Throws on anything that isn't
 * a plain http(s)/ws(s) URL so a typo fails loudly rather than widening the
 * policy.
 */
export function toOrigin(value: string, source: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`CSP config: ${source} is not a valid URL: "${value}"`);
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error(`CSP config: ${source} has unsupported protocol ${url.protocol}`);
  if (url.username || url.password) throw new Error(`CSP config: ${source} must not contain credentials`);
  return url.origin;
}

/** http(s)://host → ws(s)://host (the app derives its WebSocket URL the same way). */
export function wsOriginOf(httpOrigin: string): string {
  return httpOrigin.replace(/^http/, "ws");
}

const list = (value: string | undefined): string[] =>
  (value ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

type Env = Record<string, string | undefined>;

export function buildSecurityConfig(env: Env = process.env): SecurityConfig {
  const dev = env.NODE_ENV !== "production";
  const origins = new Set<string>();
  const add = (value: string | undefined, source: string) => {
    if (value) origins.add(toOrigin(value, source));
  };

  // Backend API + its WebSocket feeds (src/lib/api/client.ts wsUrl()).
  const api = toOrigin(env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081", "NEXT_PUBLIC_API_URL");
  origins.add(api);
  origins.add(wsOriginOf(api));

  // Soroban RPC + Horizon for the active network (src/lib/soroban/networks.ts),
  // plus the pipeline's and runtime-config's overrides.
  const networkName = (env.NEXT_PUBLIC_STELLAR_NETWORK ?? "testnet") as SorobanNetwork;
  const network = NETWORKS[networkName] ?? NETWORKS.testnet;
  add(network.rpcUrl, `NETWORKS.${network.name}.rpcUrl`);
  add(network.horizonUrl, `NETWORKS.${network.name}.horizonUrl`);
  add(env.NEXT_PUBLIC_SOROBAN_RPC_URL, "NEXT_PUBLIC_SOROBAN_RPC_URL");
  add(env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL");
  add(env.NEXT_PUBLIC_HORIZON_URL, "NEXT_PUBLIC_HORIZON_URL");

  // Contract-drift reports (src/lib/api/contractError.ts).
  add(env.NEXT_PUBLIC_MONITOR_URL, "NEXT_PUBLIC_MONITOR_URL");

  for (const extra of list(env.CSP_EXTRA_CONNECT_SRC)) add(extra, "CSP_EXTRA_CONNECT_SRC");

  const mode: CspMode = env.CSP_MODE === "enforce" ? "enforce" : "report-only";

  return {
    mode,
    dev,
    connectSrc: [...origins].sort(),
    frameSrc: list(env.CSP_EXTRA_FRAME_SRC).map((o) => toOrigin(o, "CSP_EXTRA_FRAME_SRC")),
    embedAncestors: list(env.CSP_EMBED_ANCESTORS).map((o) => (o === "'self'" ? o : toOrigin(o, "CSP_EMBED_ANCESTORS"))),
    reportPath: CSP_REPORT_PATH,
    hsts: !dev,
  };
}

// ── Policy ────────────────────────────────────────────────────────────────────

export function generateNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export function buildCsp(nonce: string, config: SecurityConfig, opts: { embed?: boolean } = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // 'strict-dynamic' lets Next's nonced loader pull in its own chunks.
    // 'self' / https: are ignored by CSP3 browsers and exist only as a
    // CSP2 fallback. Dev adds 'unsafe-eval' for React Refresh.
    "script-src": [`'nonce-${nonce}'`, "'strict-dynamic'", "'self'", "https:", ...(config.dev ? ["'unsafe-eval'"] : [])],
    // Tailwind ships a same-origin stylesheet and next/font inlines
    // @font-face in a <style> tag. React `style={}` attributes cannot carry
    // a nonce, so 'unsafe-inline' is required for styles (not for scripts).
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", ...config.connectSrc, ...(config.dev ? ["ws://localhost:*", "http://localhost:*"] : [])],
    "worker-src": ["'self'", "blob:"],
    "manifest-src": ["'self'"],
    "frame-src": config.frameSrc.length ? ["'self'", ...config.frameSrc] : ["'self'"],
    "frame-ancestors": opts.embed ? (config.embedAncestors.length ? config.embedAncestors : ["'self'"]) : ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'none'"],
    "form-action": ["'self'"],
    "report-uri": [config.reportPath],
    "report-to": ["csp-endpoint"],
  };
  const policy = Object.entries(directives).map(([k, v]) => `${k} ${v.join(" ")}`);
  if (!config.dev && config.mode === "enforce") policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

export function cspHeaderName(mode: CspMode): string {
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

/** Everything except the CSP itself. */
export function securityHeaders(config: SecurityConfig, opts: { embed?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    // Minimal set: nothing the app doesn't use. usb/hid stay available to
    // this origin for Ledger (WebUSB / WebHID), and clipboard-write for the
    // copy buttons.
    "Permissions-Policy": [
      "camera=()",
      "microphone=()",
      "geolocation=()",
      "payment=()",
      "serial=()",
      "bluetooth=()",
      "browsing-topics=()",
      "usb=(self)",
      "hid=(self)",
      "clipboard-write=(self)",
    ].join(", "),
    // allow-popups: wallet flows (e.g. Albedo) talk to popups via window.opener.
    "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
    "Origin-Agent-Cluster": "?1",
    "X-DNS-Prefetch-Control": "off",
    "Reporting-Endpoints": `csp-endpoint="${config.reportPath}"`,
  };
  // Legacy clickjacking header for browsers without frame-ancestors.
  if (!opts.embed) headers["X-Frame-Options"] = "DENY";
  // Preload-ready: 2 years, subdomains, preload. Only sent in production.
  if (config.hsts) headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload";
  return headers;
}
