/**
 * Encrypted session cookie for the BFF (#118). Server-only.
 *
 * The backend's bearer token is sealed with AES-256-GCM, using a key derived
 * with HKDF from BFF_SESSION_SECRET, and stored in an httpOnly, Secure,
 * SameSite=Strict cookie. JavaScript in the page can never read it, so an
 * XSS can no longer steal the session. It could still make requests while
 * the page is open; CSP (#117) and CSRF checks narrow that.
 *
 * Uses Web Crypto only, so it runs in both the Node and Edge runtimes.
 */

import { CSRF_COOKIE, SESSION_COOKIE } from "./constants";

export interface SessionPayload {
  /** Backend bearer token. */
  t: string;
  /** Wallet address the token was issued for. */
  a: string;
  /** Expiry, epoch ms. */
  exp: number;
}

const SESSION_MS = 24 * 60 * 60 * 1000;
const VERSION = "v1";
const AAD = new TextEncoder().encode("zenith-bff-session-v1");

// ── Config ────────────────────────────────────────────────────────────────────

let devSecret: string | null = null;

export function sessionSecret(): string {
  const secret = process.env.BFF_SESSION_SECRET;
  if (secret && secret.length >= 32) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("BFF_SESSION_SECRET must be set (≥32 chars) in production");
  }
  // Dev fallback: random per process — sessions don't survive a restart.
  if (!devSecret) {
    devSecret = base64url(crypto.getRandomValues(new Uint8Array(32)));
    console.warn("[bff] BFF_SESSION_SECRET not set — using an ephemeral development secret.");
  }
  return devSecret;
}

/** Whether cookies are marked Secure (and get the __Host- prefix). */
export function secureCookies(requestUrl?: string): boolean {
  if (process.env.BFF_INSECURE_COOKIES === "1") return false; // plain-http self-host escape hatch
  if (process.env.NODE_ENV === "production") return true;
  return !!requestUrl && requestUrl.startsWith("https:");
}

export function sessionCookieName(secure: boolean): string {
  return secure ? SESSION_COOKIE.secure : SESSION_COOKIE.insecure;
}

export function csrfCookieName(secure: boolean): string {
  return secure ? CSRF_COOKIE.secure : CSRF_COOKIE.insecure;
}

// ── Encoding helpers ──────────────────────────────────────────────────────────

export function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64url(text: string): Uint8Array {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(text.length / 4) * 4, "=");
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function sessionKey(secret: string): Promise<CryptoKey> {
  let key = keyCache.get(secret);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", new TextEncoder().encode(secret), "HKDF", false, ["deriveKey"])
      .then((base) =>
        crypto.subtle.deriveKey(
          { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode("zenith-bff"), info: new TextEncoder().encode("session-v1") },
          base,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"]
        )
      );
    keyCache.set(secret, key);
  }
  return key;
}

// ── Seal / unseal ─────────────────────────────────────────────────────────────

export async function sealSession(payload: SessionPayload, secret = sessionSecret()): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: AAD }, await sessionKey(secret), plaintext);
  return `${VERSION}.${base64url(iv)}.${base64url(new Uint8Array(ciphertext))}`;
}

/** Returns null for missing, tampered, foreign-key, or expired cookies. */
export async function unsealSession(value: string | undefined | null, secret = sessionSecret(), now = Date.now()): Promise<SessionPayload | null> {
  if (!value) return null;
  const [version, ivText, ctText] = value.split(".");
  if (version !== VERSION || !ivText || !ctText) return null;
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64url(ivText), additionalData: AAD },
      await sessionKey(secret),
      fromBase64url(ctText)
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
    if (typeof payload.t !== "string" || typeof payload.a !== "string" || typeof payload.exp !== "number") return null;
    return payload.exp > now ? payload : null;
  } catch {
    return null;
  }
}

/** JWT `exp` if the backend token is a JWT, else now + 24h (the backend's documented session length). */
export function tokenExpiry(token: string, now = Date.now()): number {
  try {
    const payload = JSON.parse(new TextDecoder().decode(fromBase64url(token.split(".")[1])));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Not a JWT.
  }
  return now + SESSION_MS;
}

// ── Cookie attributes ─────────────────────────────────────────────────────────

export interface CookieSpec {
  name: string;
  value: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "strict" | "lax";
  path: "/";
  maxAge: number;
}

export function sessionCookie(value: string, expiresAt: number, secure: boolean, now = Date.now()): CookieSpec {
  return {
    name: sessionCookieName(secure),
    value,
    httpOnly: true,
    secure,
    sameSite: "strict",
    path: "/",
    maxAge: Math.max(0, Math.floor((expiresAt - now) / 1000)),
  };
}

/** Double-submit CSRF cookie — readable by JS by design; SameSite=Strict. */
export function csrfCookie(value: string, secure: boolean): CookieSpec {
  return { name: csrfCookieName(secure), value, httpOnly: false, secure, sameSite: "strict", path: "/", maxAge: SESSION_MS / 1000 };
}

export function clearedCookie(name: string, secure: boolean, httpOnly: boolean): CookieSpec {
  return { name, value: "", httpOnly, secure, sameSite: "strict", path: "/", maxAge: 0 };
}
