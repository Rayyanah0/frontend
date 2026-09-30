"use client";

/**
 * useIntegrityGuard — React hook that wires validateTick + integrityStore.
 *
 * This hook is the single integration point between raw feed ticks (any shape)
 * and the integrity sub-system. Consumers (SpotFeedContext, useChainFeed, etc.)
 * call `processTick` once per received tick. The hook:
 *
 *  1. Calls validateTick with the current per-symbol baselines.
 *  2. If the tick passes, calls `recordAccept` for each symbol and returns the
 *     tick untouched.
 *  3. If the tick fails, calls `recordReject` for the offending symbol, emits a
 *     sampled monitoring event, and returns null (the caller should drop the tick).
 *  4. Exposes the per-symbol integrity state so components can read it without
 *     importing the store directly.
 *
 * Oracle prices can be injected via `setOraclePrices` (called by the oracle
 * panel component when it receives a fresh quote).
 */

import { useCallback, useRef } from "react";
import { useIntegrityStore } from "./integrityStore";
import {
  validateTick,
  type RawTick,
  type ValidationConfig,
  type RejectResult,
} from "./validateTick";
import { captureMessage } from "../monitoring";

// Fraction of rejection events forwarded to the monitoring back-end.
// 1.0 = every rejection; 0.1 = ~10% sample.  Keep low in production to
// avoid flooding Sentry with noisy feed events.
const MONITORING_SAMPLE_RATE = 0.1;

interface UseIntegrityGuardOptions {
  /** Validation thresholds; defaults are applied inside validateTick. */
  config?: ValidationConfig;
}

export interface IntegrityGuardHandle {
  /**
   * Validate an incoming tick. Returns the original tick if accepted, or null
   * if it was dropped (caller should discard it entirely).
   */
  processTick: (tick: RawTick) => RawTick | null;

  /**
   * Inject the latest oracle prices for cross-checking. Call this whenever the
   * oracle panel receives a fresh quote.
   */
  setOraclePrices: (prices: Record<string, number>) => void;

  /**
   * Signal that the underlying WebSocket reconnected. Resets all symbol
   * baselines so the first post-reconnect tick is always accepted (and seeds
   * the new baseline) rather than being rejected as a spurious jump.
   */
  handleReconnect: () => void;
}

export function useIntegrityGuard(
  opts: UseIntegrityGuardOptions = {},
): IntegrityGuardHandle {
  const { recordAccept, recordReject, getBaseline, symbols, resetAll } =
    useIntegrityStore();

  // Oracle prices live in a ref so they don't trigger re-renders when updated.
  const oraclePricesRef = useRef<Record<string, number> | undefined>(undefined);

  const processTick = useCallback(
    (tick: RawTick): RawTick | null => {
      // Build a snapshot of all current baselines for this tick.
      const baselines: Record<string, import("./validateTick").SymbolBaseline> = {};
      for (const sym of Object.keys(tick.prices)) {
        baselines[sym] = getBaseline(sym);
      }

      const result = validateTick(
        tick,
        baselines,
        opts.config,
        oraclePricesRef.current,
      );

      if (result.accept) {
        // Record an accept for every symbol in the tick.
        for (const sym of Object.keys(tick.prices)) {
          recordAccept(sym, tick.prices[sym]);
        }
        return tick;
      }

      // Tick rejected — record and optionally emit to monitoring.
      const rejection = result as RejectResult;
      recordReject(rejection.symbol, rejection.reason);
      emitRejectionEvent(rejection);
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opts.config, recordAccept, recordReject, getBaseline],
  );

  const setOraclePrices = useCallback((prices: Record<string, number>) => {
    oraclePricesRef.current = prices;
  }, []);

  const handleReconnect = useCallback(() => {
    resetAll();
  }, [resetAll]);

  return { processTick, setOraclePrices, handleReconnect };
}

// ─── Monitoring ──────────────────────────────────────────────────────────────

function emitRejectionEvent(rejection: RejectResult): void {
  // Sample: only forward a fraction of events to avoid overwhelming Sentry.
  if (Math.random() > MONITORING_SAMPLE_RATE) return;

  // Fire-and-forget; we don't await here because processTick is on the hot
  // path (called for every WS frame) and monitoring failures must never block
  // the feed handler.
  void captureMessage(
    `[integrity] tick rejected: ${rejection.reason} (${rejection.symbol} = ${rejection.value})`,
    "warning",
  );
}
