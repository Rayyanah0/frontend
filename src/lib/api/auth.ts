import { apiPost, ensureCsrfToken } from "./client";
import { NonceResponseSchema } from "./schemas";
import { BFF_SESSION_ROUTE, CSRF_HEADER, type SessionInfo } from "../bff/constants";

export interface NonceResponse {
  nonce?: string;
  message?: string;
}

export function requestNonce(walletAddress: string): Promise<NonceResponse> {
  return apiPost("/api/v1/auth/nonce", { wallet_address: walletAddress }, undefined, NonceResponseSchema);
}

export interface VerifyResponse {
  token?: string;
  wallet_address?: string;
}

async function sessionRequest(method: "GET" | "POST" | "DELETE", body?: unknown): Promise<SessionInfo> {
  const headers = new Headers();
  if (method !== "GET") {
    const csrf = await ensureCsrfToken();
    if (csrf) headers.set(CSRF_HEADER, csrf);
  }
  if (body !== undefined) headers.set("content-type", "application/json");
  const res = await fetch(BFF_SESSION_ROUTE, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
    cache: "no-store",
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : `Session request failed (${res.status})`);
  return data as SessionInfo;
}

/**
 * Exchanges a wallet signature for an httpOnly session cookie (#118). The
 * BFF calls the backend's verify endpoint. The bearer token stays
 * server-side and only non-secret session info comes back.
 */
export function createSession(params: {
  walletAddress: string;
  message: string;
  signature: string; // base64-encoded 64-byte ed25519 signature
}): Promise<SessionInfo> {
  return sessionRequest("POST", {
    wallet_address: params.walletAddress,
    message: params.message,
    signature: params.signature,
  });
}

/** Current session, validated against the backend by the BFF. */
export function getSession(): Promise<SessionInfo> {
  return sessionRequest("GET");
}

/** Clears the session cookie (sign-out; applies to every tab). */
export function deleteSession(): Promise<SessionInfo> {
  return sessionRequest("DELETE");
}

}
