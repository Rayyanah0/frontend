import { apiGet, apiPost, ApiError, type RequestOptions } from "./client";
import type { Position } from "./types";

export interface ClosePositionBody {
  /** Contracts to close. Omit or equal full size for a full close. */
  contracts?: number;
}

export interface FeatureFlags {
  partialClose: boolean;
  strategyClose: boolean;
}

let cachedFlags: FeatureFlags | null = null;
let flagsPromise: Promise<FeatureFlags> | null = null;

/**
 * Probe backend capability. Prefer GET /api/v1/features when present;
 * otherwise infer from OPTIONS / known 404/405 responses on the new routes.
 */
export async function detectCloseFeatures(token?: string | null): Promise<FeatureFlags> {
  if (cachedFlags) return cachedFlags;
  if (flagsPromise) return flagsPromise;

  flagsPromise = (async () => {
    try {
      const flags = await apiGet<{ partial_close?: boolean; strategy_close?: boolean }>(
        "/api/v1/features",
        token
      );
      cachedFlags = {
        partialClose: !!flags.partial_close,
        strategyClose: !!flags.strategy_close,
      };
      return cachedFlags;
    } catch {
      // No features endpoint — assume unsupported until a successful probe.
      cachedFlags = { partialClose: false, strategyClose: false };
      return cachedFlags;
    }
  })();

  return flagsPromise;
}

export function resetCloseFeatureCache() {
  cachedFlags = null;
  flagsPromise = null;
}

/**
 * POST /api/v1/positions/{id}/close with optional { contracts }.
 * When the backend rejects the body (404/400/422), callers should fall back
 * to full closePosition() or sequential per-leg closes.
 */
export function closePositionPartial(
  id: string,
  body: ClosePositionBody,
  token: string,
  opts?: RequestOptions
): Promise<Position> {
  return apiPost(`/api/v1/positions/${id}/close`, body.contracts != null ? { contracts: body.contracts } : undefined, token, undefined, opts);
}

/**
 * POST /api/v1/strategies/{id}/close — atomic multi-leg close when supported.
 */
export function closeStrategy(strategyId: string, token: string, opts?: RequestOptions): Promise<Position[]> {
  return apiPost(`/api/v1/strategies/${strategyId}/close`, undefined, token, undefined, opts);
}

export function isUnsupportedCloseError(err: unknown): boolean {
  return err instanceof ApiError && (err.status === 404 || err.status === 405 || err.status === 501);
}
