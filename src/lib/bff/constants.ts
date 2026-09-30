/**
 * Backend-for-frontend constants shared by the browser and the route
 * handlers (#118). Nothing secret lives here.
 */

/** All authed backend calls from the browser go through this prefix. */
export const BFF_PREFIX = "/api/bff";
export const BFF_SESSION_ROUTE = `${BFF_PREFIX}/session`;

/**
 * Cookie names. The `__Host-` prefix (Secure, Path=/, no Domain) is used
 * whenever the cookie is Secure, i.e. in production and over HTTPS. Plain
 * names are only used for http://localhost development.
 */
export const SESSION_COOKIE = { secure: "__Host-zenith_session", insecure: "zenith_session" } as const;
export const CSRF_COOKIE = { secure: "__Host-zenith_csrf", insecure: "zenith_csrf" } as const;

/** Request header carrying the double-submit CSRF token. */
export const CSRF_HEADER = "x-zenith-csrf";

/**
 * Non-secret marker stored in the wallet store while a BFF session exists.
 * The bearer token itself only ever lives in the encrypted httpOnly cookie.
 */
export const BFF_SESSION_MARKER = "bff-session" as const;
export type SessionMarker = typeof BFF_SESSION_MARKER;

/** Public shape returned by GET/POST /api/bff/session — never includes the token. */
export interface SessionInfo {
  authenticated: boolean;
  wallet_address: string | null;
  /** Epoch ms. */
  expires_at: number | null;
}
