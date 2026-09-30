"use client";

/**
 * BackendDataProvider — single source of truth for all backend-fetched data.
 *
 * Performance contract
 * ──────────────────────────────────────────────────────────────────────────
 * The context value object is constructed with `useMemo` so it is referentially
 * stable between renders: consumers that subscribe via `useBackendData()` only
 * re-render when a piece of data they *actually use* has changed.  Each
 * "data slice" (account, positions, greeks, watchlist, alerts) is kept in its
 * own independent state variable — an alert refresh must never re-render
 * PortfolioBar, which only reads `positions` and `greeks`.
 *
 * Hydration safety
 * ──────────────────────────────────────────────────────────────────────────
 * Gated on `useHydrated()` so we never pass a wallet token obtained from
 * `localStorage` before the first client-side mount.  Server-rendered HTML
 * always sees `null` token, avoiding SSR mismatches.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useHydrated } from "../useHydrated";
import { useWalletStore } from "../store/wallet";
import { getAccount, listPositions, getPortfolioGreeks } from "../api/positions";
import {
  getWatchlist,
  addToWatchlist as apiAddToWatchlist,
  removeFromWatchlist as apiRemoveFromWatchlist,
} from "../api/watchlist";
import { getAlerts, createAlert, deleteAlert } from "../api/alerts";
import {
  closePosition,
  closePositionPartial,
  closeStrategy,
  rollPosition,
  detectCloseFeatures,
  type ClosePositionBody,
} from "../api/positions";
import type {
  Account,
  AggregateGreeks,
  Position,
  WatchlistItem,
  Alert,
  AlertCondition,
} from "../api/types";

// ─── Context shape ─────────────────────────────────────────────────────────────
export interface BackendDataContextValue {
  // ── Data ──────────────────────────────────────────────────────────────────
  account: Account | null;
  positions: Position[];
  greeks: AggregateGreeks | null;
  watchlist: WatchlistItem[];
  alerts: Alert[];

  // ── Loading flags ─────────────────────────────────────────────────────────
  accountLoading: boolean;
  positionsLoading: boolean;

  // ── Actions — memoized with useCallback so identity is stable ─────────────
  refreshAccount: () => void;
  refreshPositions: () => void;

  /** Close a position (partial if `body.contracts` < total). */
  close: (id: string, body?: ClosePositionBody) => Promise<void>;
  /** Roll a position to a new strike/expiry. */
  roll: (id: string, params: { newStrike: number; newExpiryDays: number }) => Promise<void>;

  addToWatchlist: (underlying: string) => Promise<void>;
  removeFromWatchlist: (underlying: string) => Promise<void>;

  addAlert: (params: {
    underlying: string;
    condition: AlertCondition;
    targetPrice: number;
  }) => Promise<void>;
  removeAlert: (id: string) => Promise<void>;
}

const BackendDataContext = createContext<BackendDataContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────
export function BackendDataProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const token = useWalletStore((s) => s.token);
  // Only expose the token once hydration has completed so we never accidentally
  // read a stale/server value.
  const activeToken = hydrated ? token : null;

  // ── Independent data slices (each can update without touching the others) ──
  const [account, setAccount] = useState<Account | null>(null);
  const [accountLoading, setAccountLoading] = useState(false);

  const [positions, setPositions] = useState<Position[]>([]);
  const [positionsLoading, setPositionsLoading] = useState(false);

  const [greeks, setGreeks] = useState<AggregateGreeks | null>(null);
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);

  // Close-feature probe: cached once so we don't re-request /features on
  // every close attempt.  Stored in a ref because it doesn't need to be
  // part of the render cycle.
  const closeFeaturesRef = useRef<Awaited<ReturnType<typeof detectCloseFeatures>> | null>(null);

  // ── Fetch helpers ──────────────────────────────────────────────────────────
  const refreshAccount = useCallback(() => {
    if (!activeToken) { setAccount(null); return; }
    setAccountLoading(true);
    getAccount(activeToken)
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setAccountLoading(false));
  }, [activeToken]);

  const refreshPositions = useCallback(() => {
    if (!activeToken) { setPositions([]); setGreeks(null); return; }
    setPositionsLoading(true);
    Promise.all([
      listPositions(activeToken, { status: "open" }),
      getPortfolioGreeks(activeToken),
    ])
      .then(([pos, g]) => {
        setPositions(pos);
        setGreeks(g);
      })
      .catch(() => {
        setPositions([]);
        setGreeks(null);
      })
      .finally(() => setPositionsLoading(false));
  }, [activeToken]);

  const refreshWatchlist = useCallback(() => {
    if (!activeToken) { setWatchlist([]); return; }
    getWatchlist(activeToken)
      .then(setWatchlist)
      .catch(() => setWatchlist([]));
  }, [activeToken]);

  const refreshAlerts = useCallback(() => {
    if (!activeToken) { setAlerts([]); return; }
    getAlerts(activeToken)
      .then(setAlerts)
      .catch(() => setAlerts([]));
  }, [activeToken]);

  // ── Bootstrap on token change ──────────────────────────────────────────────
  useEffect(() => {
    refreshAccount();
    refreshPositions();
    refreshWatchlist();
    refreshAlerts();
  }, [refreshAccount, refreshPositions, refreshWatchlist, refreshAlerts]);

  // ── Action callbacks — stable identity (useCallback deps are all stable) ───
  const close = useCallback(
    async (id: string, body?: ClosePositionBody) => {
      if (!activeToken) throw new Error("Not signed in");
      // Probe once; result is cached in ref.
      if (!closeFeaturesRef.current) {
        closeFeaturesRef.current = await detectCloseFeatures(activeToken);
      }
      const features = closeFeaturesRef.current;
      if (body?.contracts != null && features.partialClose) {
        await closePositionPartial(id, body, activeToken);
      } else {
        await closePosition(id, activeToken);
      }
      refreshPositions();
      refreshAccount();
    },
    [activeToken, refreshPositions, refreshAccount],
  );

  const roll = useCallback(
    async (id: string, params: { newStrike: number; newExpiryDays: number }) => {
      if (!activeToken) throw new Error("Not signed in");
      await rollPosition(id, params, activeToken);
      refreshPositions();
      refreshAccount();
    },
    [activeToken, refreshPositions, refreshAccount],
  );

  const addToWatchlist = useCallback(
    async (underlying: string) => {
      if (!activeToken) throw new Error("Not signed in");
      await apiAddToWatchlist(underlying, activeToken);
      refreshWatchlist();
    },
    [activeToken, refreshWatchlist],
  );

  const removeFromWatchlist = useCallback(
    async (underlying: string) => {
      if (!activeToken) throw new Error("Not signed in");
      await apiRemoveFromWatchlist(underlying, activeToken);
      refreshWatchlist();
    },
    [activeToken, refreshWatchlist],
  );

  const addAlert = useCallback(
    async (params: { underlying: string; condition: AlertCondition; targetPrice: number }) => {
      if (!activeToken) throw new Error("Not signed in");
      await createAlert(params, activeToken);
      refreshAlerts();
    },
    [activeToken, refreshAlerts],
  );

  const removeAlert = useCallback(
    async (id: string) => {
      if (!activeToken) throw new Error("Not signed in");
      await deleteAlert(id, activeToken);
      refreshAlerts();
    },
    [activeToken, refreshAlerts],
  );

  // ── Stable context value ───────────────────────────────────────────────────
  // All primitives/arrays in the deps list are the exact state variables from
  // above. React only creates a new object when one of them actually changes,
  // so none of the ~13 consumers re-render spuriously on unrelated data
  // refreshes.
  const value = useMemo<BackendDataContextValue>(
    () => ({
      account,
      positions,
      greeks,
      watchlist,
      alerts,
      accountLoading,
      positionsLoading,
      refreshAccount,
      refreshPositions,
      close,
      roll,
      addToWatchlist,
      removeFromWatchlist,
      addAlert,
      removeAlert,
    }),
    [
      account,
      positions,
      greeks,
      watchlist,
      alerts,
      accountLoading,
      positionsLoading,
      refreshAccount,
      refreshPositions,
      close,
      roll,
      addToWatchlist,
      removeFromWatchlist,
      addAlert,
      removeAlert,
    ],
  );

  return (
    <BackendDataContext.Provider value={value}>{children}</BackendDataContext.Provider>
  );
}

// ─── Consumer hook ─────────────────────────────────────────────────────────────
export function useBackendData(): BackendDataContextValue {
  const ctx = useContext(BackendDataContext);
  if (!ctx) {
    throw new Error("useBackendData must be used within a BackendDataProvider");
  }
  return ctx;
}
