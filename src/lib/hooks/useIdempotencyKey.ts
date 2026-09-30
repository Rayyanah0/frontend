"use client";

import { useCallback, useRef } from "react";
import { IntentKeyManager } from "../api/resilience";

/**
 * Idempotency key for one user intent (e.g. "buy 2 XLM 0.12C 30d").
 *
 *   const { keyFor, complete } = useIdempotencyKey();
 *   await openPosition(params, token, { idempotencyKey: keyFor(params) });
 *   complete();   // only after success
 *
 * Re-clicking Confirm after a timeout / network error with the same params
 * reuses the key, so the backend dedupes the resubmit. Editing any parameter
 * or completing successfully yields a new key for the next intent.
 */
export function useIdempotencyKey() {
  const manager = useRef<IntentKeyManager | null>(null);
  manager.current ??= new IntentKeyManager();
  const keyFor = useCallback((intent: unknown) => manager.current!.keyFor(intent), []);
  const complete = useCallback(() => manager.current!.complete(), []);
  return { keyFor, complete };
}
