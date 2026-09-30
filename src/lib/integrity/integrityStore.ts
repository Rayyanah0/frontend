/**
 * integrityStore — per-symbol market-data integrity state, backed by Zustand.
 *
 * Responsibilities:
 *  - Maintain a rolling price window per symbol (last N accepted prices) so
 *    the validation pipeline can compute a median baseline without holding
 *    state itself.
 *  - Count consecutive rejected ticks per symbol so the UI can show a warning
 *    and disable trading after N failures.
 *  - Track the "integrity OK" vs "integrity doubt" status per symbol that
 *    TradeTicket and DataIntegrityBanner read.
 *  - Expose `recordAccept` / `recordReject` mutation actions.
 *  - Expose `resetSymbol` (called on WS reconnect to clear stale baselines).
 *
 * This store is NOT persisted — integrity state is ephemeral and must be
 * re-established from fresh ticks on each page load or reconnect.
 */

import { create } from "zustand";
import { rollingMedian, type SymbolBaseline, type RejectReason } from "./validateTick";

// ─── Config ───────────────────────────────────────────────────────────────────

/**
 * Number of accepted prices to keep in the rolling window used for median
 * computation. 20 accepted ticks ≈ 40 seconds of feed at ~2s per tick.
 */
export const MEDIAN_WINDOW_SIZE = 20;

/**
 * Number of consecutive rejected ticks before a symbol is flagged as
 * "integrity in doubt" (trading disabled, banner shown).
 */
export const CONSECUTIVE_REJECT_THRESHOLD = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SymbolIntegrityState {
  /** Rolling window of the last N *accepted* prices. */
  priceWindow: number[];
  /** Median derived from priceWindow; undefined until first accept. */
  medianPrice: number | undefined;
  /** Total ticks accepted since reset. */
  acceptCount: number;
  /** Total ticks rejected since reset. */
  rejectCount: number;
  /** How many consecutive rejects without an intervening accept. */
  consecutiveRejects: number;
  /**
   * True if the feed just reconnected (first tick after reconnect is treated
   * as a new baseline regardless of jump size).
   */
  reconnected: boolean;
  /**
   * "ok"    — feed is healthy; trading allowed.
   * "doubt" — consecutiveRejects >= CONSECUTIVE_REJECT_THRESHOLD; trading
   *            blocked, banner shown.
   * "unknown" — no ticks received yet for this symbol.
   */
  status: "ok" | "doubt" | "unknown";
  /** Reason for the most recent rejection (for display). */
  lastRejectReason: RejectReason | null;
  /** ISO timestamp of the most recent rejection. */
  lastRejectAt: string | null;
  /** ISO timestamp of the most recent successful accept. */
  lastAcceptAt: string | null;
}

export interface IntegrityStoreState {
  /** Per-symbol integrity state. Missing keys mean "unknown". */
  symbols: Record<string, SymbolIntegrityState>;

  /**
   * Call after a tick is accepted for `symbol`. Updates the rolling window,
   * median, and resets consecutive-reject counter.
   */
  recordAccept: (symbol: string, price: number) => void;

  /**
   * Call after a tick is rejected for `symbol`. Increments counters and
   * potentially flips the status to "doubt".
   */
  recordReject: (symbol: string, reason: RejectReason) => void;

  /**
   * Reset a symbol's state (e.g. on WS reconnect). The `reconnected` flag is
   * set so validateTick skips the jump check for the first incoming tick.
   */
  resetSymbol: (symbol: string) => void;

  /** Reset ALL symbols (e.g. on a full reconnect). */
  resetAll: () => void;

  /**
   * Returns the SymbolBaseline expected by validateTick for the given symbol.
   * The return value is derived from current state — callers should call this
   * just before calling validateTick so they get the latest snapshot.
   */
  getBaseline: (symbol: string) => SymbolBaseline;

  /** Convenience: is trading for `symbol` currently blocked? */
  isTradingBlocked: (symbol: string) => boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function emptySymbolState(): SymbolIntegrityState {
  return {
    priceWindow: [],
    medianPrice: undefined,
    acceptCount: 0,
    rejectCount: 0,
    consecutiveRejects: 0,
    reconnected: true, // treat first-ever tick as a post-reconnect tick
    status: "unknown",
    lastRejectReason: null,
    lastRejectAt: null,
    lastAcceptAt: null,
  };
}

function getOrCreate(
  symbols: Record<string, SymbolIntegrityState>,
  symbol: string,
): SymbolIntegrityState {
  return symbols[symbol] ?? emptySymbolState();
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useIntegrityStore = create<IntegrityStoreState>((set, get) => ({
  symbols: {},

  recordAccept(symbol, price) {
    set((state) => {
      const prev = getOrCreate(state.symbols, symbol);

      // Append to rolling window, capping at MEDIAN_WINDOW_SIZE.
      const window = [...prev.priceWindow, price].slice(-MEDIAN_WINDOW_SIZE);
      const median = rollingMedian(window);

      const next: SymbolIntegrityState = {
        ...prev,
        priceWindow: window,
        medianPrice: median,
        acceptCount: prev.acceptCount + 1,
        consecutiveRejects: 0,      // reset streak on accept
        reconnected: false,          // clear reconnect grace after first accept
        status: "ok",
        lastAcceptAt: new Date().toISOString(),
      };

      return { symbols: { ...state.symbols, [symbol]: next } };
    });
  },

  recordReject(symbol, reason) {
    set((state) => {
      const prev = getOrCreate(state.symbols, symbol);
      const consecutive = prev.consecutiveRejects + 1;

      const next: SymbolIntegrityState = {
        ...prev,
        rejectCount: prev.rejectCount + 1,
        consecutiveRejects: consecutive,
        status: consecutive >= CONSECUTIVE_REJECT_THRESHOLD ? "doubt" : prev.status === "unknown" ? "unknown" : prev.status,
        lastRejectReason: reason,
        lastRejectAt: new Date().toISOString(),
      };

      return { symbols: { ...state.symbols, [symbol]: next } };
    });
  },

  resetSymbol(symbol) {
    set((state) => {
      const prev = getOrCreate(state.symbols, symbol);
      const next: SymbolIntegrityState = {
        ...emptySymbolState(),
        // Preserve accept/reject totals so the banner has a meaningful
        // historical count even after reconnect.
        acceptCount: prev.acceptCount,
        rejectCount: prev.rejectCount,
        reconnected: true,
        status: "unknown",
      };
      return { symbols: { ...state.symbols, [symbol]: next } };
    });
  },

  resetAll() {
    set({ symbols: {} });
  },

  getBaseline(symbol) {
    const s = get().symbols[symbol];
    if (!s) return { reconnected: true }; // no history → treat as new
    return {
      medianPrice: s.medianPrice,
      lastAcceptedAt: s.lastAcceptAt ? new Date(s.lastAcceptAt).getTime() : undefined,
      reconnected: s.reconnected,
    };
  },

  isTradingBlocked(symbol) {
    const s = get().symbols[symbol];
    if (!s) return false; // no history → don't block (first load)
    return s.status === "doubt";
  },
}));
