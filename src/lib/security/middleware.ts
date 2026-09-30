/**
 * Security-header plumbing for src/middleware.ts (#117). Lives outside the
 * middleware file so it can be unit-tested and composed with other
 * middleware (next-intl).
 */

import type { NextRequest } from "next/server";
import {
  EMBED_ROUTE,
  buildCsp,
  buildSecurityConfig,
  cspHeaderName,
  securityHeaders,
  type SecurityConfig,
} from "./csp";

// Built once per server instance from validated env. An invalid origin
// throws here, so the server fails closed instead of running with a
// widened policy.
let cached: SecurityConfig | null = null;
const securityConfig = () => (cached ??= buildSecurityConfig());

/**
 * Forwards modified request headers through an existing middleware
 * response. This does the same thing as `NextResponse.next({ request: { headers } })`,
 * but works on responses produced by other middleware (e.g. next-intl
 * rewrites/redirects) and merges with any overrides they already set.
 */
export function forwardRequestHeaders(response: Response, headers: Record<string, string>): void {
  const existing = response.headers.get("x-middleware-override-headers");
  const keys = new Set(existing ? existing.split(",").map((k) => k.trim()).filter(Boolean) : []);
  for (const [name, value] of Object.entries(headers)) {
    const key = name.toLowerCase();
    keys.add(key);
    response.headers.set(`x-middleware-request-${key}`, value);
  }
  response.headers.set("x-middleware-override-headers", [...keys].join(","));
}

export function applySecurity(request: NextRequest, response: Response, nonce: string): Response {
  const cfg = securityConfig();
  const embed = EMBED_ROUTE.test(request.nextUrl.pathname);
  const csp = buildCsp(nonce, cfg, { embed });
  const cspHeader = cspHeaderName(cfg.mode);

  forwardRequestHeaders(response, { "x-nonce": nonce, [cspHeader]: csp });
  response.headers.set(cspHeader, csp);
  for (const [name, value] of Object.entries(securityHeaders(cfg, { embed }))) response.headers.set(name, value);
  return response;
}
