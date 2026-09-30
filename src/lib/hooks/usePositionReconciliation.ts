"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchOnChainPositions,
  reconcilePositions,
  sendDiscrepancyReport,
  type OnChainPosition,
  type PositionDiscrepancy,
} from "../api/reconciliation";
import { useWalletStore } from "../store/wallet";
import type { Position } from "../api/types";

export interface ReconciliationResult {
  onChainPositions: OnChainPosition[];
  discrepancies: PositionDiscrepancy[];
  /** Set of backend position IDs that are fully verified on-chain. */
  verifiedIds: Set<string>;
  loading: boolean;
  error: string | null;
  /** Timestamp of the last successful reconciliation run. */
  lastChecked: Date | null;
  refresh: () => void;
}

/**
 * Fetches on-chain positions for the connected wallet, reconciles them
 * against the provided backend positions list, and sends any discrepancies
 * to the monitoring endpoint (wallet address is hashed before sending).
 *
 * Pass `backendPositions` from `useBackendData().positions` — the hook
 * re-runs automatically whenever that list or the wallet address changes.
 */
export function usePositionReconciliation(
  backendPositions: Position[]
): ReconciliationResult {
  const { address, session: token } = useWalletStore();

  const [onChainPositions, setOnChainPositions] = useState<OnChainPosition[]>([]);
  const [discrepancies, setDiscrepancies] = useState<PositionDiscrepancy[]>([]);
  const [verifiedIds, setVerifiedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const refresh = useCallback(() => {
    if (!address || !token) {
      setOnChainPositions([]);
      setDiscrepancies([]);
      setVerifiedIds(new Set());
      return;
    }

    setLoading(true);
    setError(null);

    fetchOnChainPositions(address, token)
      .then((onChain) => {
        setOnChainPositions(onChain);

        const diffs = reconcilePositions(backendPositions, onChain);
        setDiscrepancies(diffs);

        // Verified = present in both with matching data (no discrepancy).
        const discrepancyIds = new Set(diffs.map((d) => d.positionId));
        const onChainIds = new Set(onChain.map((p) => p.id));
        const verified = new Set<string>(
          backendPositions
            .filter((p) => onChainIds.has(p.id) && !discrepancyIds.has(p.id))
            .map((p) => p.id)
        );
        setVerifiedIds(verified);
        setLastChecked(new Date());

        // Fire-and-forget monitoring report.
        void sendDiscrepancyReport(address, diffs);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Reconciliation failed");
      })
      .finally(() => setLoading(false));
  }, [address, token, backendPositions]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return {
    onChainPositions,
    discrepancies,
    verifiedIds,
    loading,
    error,
    lastChecked,
    refresh,
  };
}
