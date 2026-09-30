/**
 * CSRF protection for mutating BFF routes (#118). This is defence in depth
 * on top of SameSite=Strict cookies:
 *
 *  1. Origin check. `Origin` must be the app's own origin (or one listed in
 *     BFF_ALLOWED_ORIGINS). When `Origin` is missing, `Sec-Fetch-Site` must
 *     be "same-origin".
 *  2. Double-submit token. The `x-zenith-csrf` header must equal the CSRF
 *     cookie. A cross-site attacker can't read the cookie to copy it.
 */

import { CSRF_HEADER } from "./constants";
import { base64url } from "./session";

export const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function newCsrfToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function allowedOrigins(requestUrl: string): Set<string> {
  const origins = new Set([new URL(requestUrl).origin]);
  for (const o of (process.env.BFF_ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    origins.add(new URL(o).origin);
  }
  // Behind a proxy the internal URL may differ from the public one.
  if (process.env.NEXT_PUBLIC_SITE_URL) origins.add(new URL(process.env.NEXT_PUBLIC_SITE_URL).origin);
  return origins;
}

export type CsrfFailure = "origin" | "token";

export function checkCsrf(req: Request, csrfCookieValue: string | undefined): CsrfFailure | null {
  if (!MUTATING_METHODS.has(req.method.toUpperCase())) return null;

  const origin = req.headers.get("origin");
  if (origin) {
    if (!allowedOrigins(req.url).has(origin)) return "origin";
  } else if (req.headers.get("sec-fetch-site") !== "same-origin") {
    return "origin";
  }

  const header = req.headers.get(CSRF_HEADER);
  if (!csrfCookieValue || !header || !safeEqual(header, csrfCookieValue)) return "token";
  return null;
}
