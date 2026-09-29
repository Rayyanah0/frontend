// Thin fetch wrapper for the zenith-backend API. Caching/retry live in
// TanStack Query; this standardizes the request/error shape and, when a
// schema is passed, validates the response at runtime (ContractError).
import type { z } from "zod";
import { ContractError, reportContractError } from "./contractError";

type Schema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

/**
 * Injected by the wallet store (keeps this layer from importing it and
 * creating a cycle). Resolves to a fresh token, or null if the user
 * rejected / re-auth failed.
 */
type UnauthorizedHandler = () => Promise<string | null>;
let onUnauthorized: UnauthorizedHandler | null = null;
let reauthInFlight: Promise<string | null> | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

/** Single-flight: every concurrent 401 awaits the same re-auth call. */
function reauthenticate(): Promise<string | null> {
  if (!onUnauthorized) return Promise.resolve(null);
  if (!reauthInFlight) {
    reauthInFlight = onUnauthorized()
      .catch(() => null)
      .finally(() => {
        reauthInFlight = null;
      });
  }
  return reauthInFlight;
}

async function request<T>(path: string, init: RequestInit, token?: string | null, schema?: Schema<T>, retried = false): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("authorization", `Bearer ${token}`);

  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });

  // Only authed requests are recovered; auth endpoints (nonce/verify) never loop.
  if (res.status === 401 && token && !retried && !path.startsWith("/api/v1/auth/")) {
    const fresh = await reauthenticate();
    if (!fresh) throw new ApiError(401, "Session expired");
    const method = (init.method ?? "GET").toUpperCase();
    // Never silently replay non-idempotent calls (open/close/roll): the
    // session is restored, but the user must re-confirm the action.
    if (method !== "GET") throw new ApiError(401, "Session restored — please confirm and retry this action");
    return request<T>(path, init, fresh, true);
  }

  if (!res.ok) {
    let message = res.statusText || `request failed with ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // Body wasn't JSON (or was empty) — keep the statusText fallback.
    }
    throw new ApiError(res.status, message);
  }

  // Some successful responses (e.g. POST /watchlist's 201, DELETE's 204)
  // have no body at all — checking status codes for this is brittle
  // (easy to miss one), so just check whether there's actually anything
  // to parse instead.
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!schema) return body as T;
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const err = new ContractError(path, parsed.error.issues);
    reportContractError(err);
    throw err;
  }
  return parsed.data;
}

export function apiGet<T>(path: string, token?: string | null, schema?: Schema<T>): Promise<T> {
  return request<T>(path, { method: "GET" }, token, schema);
}

export function apiPost<T>(path: string, body?: unknown, token?: string | null, schema?: Schema<T>): Promise<T> {
  return request<T>(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    },
    token,
    schema
  );
}

export function apiDelete<T>(path: string, token?: string | null): Promise<T> {
  return request<T>(path, { method: "DELETE" }, token);
}

export function wsUrl(path: string): string {
  return `${API_BASE_URL.replace(/^http/, "ws")}${path}`;
}
