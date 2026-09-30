// Global transaction tracker store.
// Persisted so in-flight transactions resume polling after a page reload.
// Fed by pipeline events via trackTransaction() helper.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PipelineStage, SorobanFeeBreakdown, ContractCallMeta, ContractCallParams } from "../soroban/types";
import { explorerUrl } from "../soroban/pipeline";
import { sendNotification } from "../notify";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TrackerEntry {
  /** Unique pipeline ID */
  txId: string;
  /** Human-readable label */
  label: string;
  /** Optional description */
  description?: string;
  /** Current lifecycle stage */
  stage: PipelineStage;
  /** Stellar tx hash (from submitting stage onwards) */
  hash?: string;
  /** Fee breakdown (from awaiting_signature stage onwards) */
  fees?: SorobanFeeBreakdown;
  /** Decoded return value */
  returnValue?: unknown;
  /** Error message (stage === "failed") */
  error?: string;
  /** Human-readable error */
  humanError?: string;
  /** Assembled XDR (for debugging / re-signing) */
  assembledXdr?: string;
  /** Unix timestamp (ms) when the pipeline started */
  startedAt: number;
  /** Unix timestamp (ms) when the pipeline reached a terminal state */
  finishedAt?: number;
  /** Elapsed ms from pipeline */
  elapsedMs: number;
  /** Original call params — kept for retry (method, contract, args serialised as JSON) */
  retryParams?: SerializedRetryParams;
  /** Whether the entry has been dismissed from the drawer */
  dismissed: boolean;
  /** Toast already shown for this terminal event */
  toastShown: boolean;
}

/** Serialised subset of ContractCallParams safe for persisting to localStorage */
export interface SerializedRetryParams {
  contract: string;
  method: string;
  argsJson: string; // JSON.stringify(args) — best-effort; complex ScVals may not round-trip
  meta?: ContractCallMeta;
  label: string;
  priority?: "standard" | "fast";
}

// ---------------------------------------------------------------------------
// Stage ordering for the stepper component
// ---------------------------------------------------------------------------

export const STAGE_ORDER: PipelineStage[] = [
  "building",
  "simulating",
  "awaiting_signature",
  "submitting",
  "pending",
  "success",
];

export function stageIndex(stage: PipelineStage): number {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx === -1 ? -1 : idx; // failed/cancelled have index -1
}

export function isTerminalStage(stage: PipelineStage): boolean {
  return stage === "success" || stage === "failed" || stage === "cancelled";
}

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

interface TrackerState {
  entries: TrackerEntry[];
  drawerOpen: boolean;
  /** Recent fee median (stroops) — used by fee surface anomaly detection */
  recentFeeMedianStroops: number | null;

  /** Upsert a tracker entry (create if new, update if exists) */
  upsertEntry: (entry: Partial<TrackerEntry> & { txId: string }) => void;
  /** Mark entry as dismissed (hidden from drawer but kept in store) */
  dismiss: (txId: string) => void;
  /** Remove all terminal+dismissed entries */
  clearDismissed: () => void;
  setDrawerOpen: (open: boolean) => void;
  toggleDrawer: () => void;
  /** Number of in-flight (non-terminal, non-dismissed) transactions */
  inFlightCount: () => number;
  /** Entries visible in the drawer (not dismissed, most recent first) */
  visibleEntries: () => TrackerEntry[];
  /** Compute and persist the rolling median fee from recent terminal txns */
  refreshFeeMedian: () => void;
}

// ---------------------------------------------------------------------------
// Store implementation
// ---------------------------------------------------------------------------

export const useTrackerStore = create<TrackerState>()(
  persist(
    (set, get) => ({
      entries: [],
      drawerOpen: false,
      recentFeeMedianStroops: null,

      upsertEntry: (partial) => {
        set((state) => {
          const existing = state.entries.find((e) => e.txId === partial.txId);
          const now = Date.now();

          if (!existing) {
            const newEntry: TrackerEntry = {
              txId: partial.txId,
              label: partial.label ?? "Contract call",
              description: partial.description,
              stage: partial.stage ?? "building",
              hash: partial.hash,
              fees: partial.fees,
              returnValue: partial.returnValue,
              error: partial.error,
              humanError: partial.humanError,
              assembledXdr: partial.assembledXdr,
              startedAt: now,
              elapsedMs: partial.elapsedMs ?? 0,
              dismissed: false,
              toastShown: false,
              retryParams: partial.retryParams,
            };
            return { entries: [newEntry, ...state.entries].slice(0, 50) };
          }

          const updated: TrackerEntry = {
            ...existing,
            ...partial,
            // Never overwrite startedAt
            startedAt: existing.startedAt,
            // Only set finishedAt when reaching a terminal stage
            finishedAt:
              partial.stage && isTerminalStage(partial.stage) && !existing.finishedAt
                ? now
                : existing.finishedAt,
            toastShown: existing.toastShown,
          };

          // Trigger toast on terminal state (once)
          if (
            partial.stage &&
            isTerminalStage(partial.stage) &&
            !existing.toastShown
          ) {
            updated.toastShown = true;
            const label = existing.label;
            if (partial.stage === "success") {
              sendNotification("Transaction confirmed", `${label} was confirmed on-chain.`);
            } else if (partial.stage === "failed") {
              sendNotification("Transaction failed", `${label}: ${partial.humanError ?? partial.error ?? "Unknown error"}`);
            }
          }

          return {
            entries: state.entries.map((e) => (e.txId === partial.txId ? updated : e)),
          };
        });

        // Refresh median when a tx completes
        if (partial.stage && isTerminalStage(partial.stage)) {
          get().refreshFeeMedian();
        }
      },

      dismiss: (txId) => {
        set((state) => ({
          entries: state.entries.map((e) =>
            e.txId === txId ? { ...e, dismissed: true } : e
          ),
        }));
      },

      clearDismissed: () => {
        set((state) => ({
          entries: state.entries.filter((e) => !e.dismissed || !isTerminalStage(e.stage)),
        }));
      },

      setDrawerOpen: (open) => set({ drawerOpen: open }),

      toggleDrawer: () => set((s) => ({ drawerOpen: !s.drawerOpen })),

      inFlightCount: () => {
        return get().entries.filter(
          (e) => !isTerminalStage(e.stage) && !e.dismissed
        ).length;
      },

      visibleEntries: () => {
        return get().entries.filter((e) => !e.dismissed);
      },

      refreshFeeMedian: () => {
        const recent = get()
          .entries
          .filter((e) => e.stage === "success" && e.fees)
          .slice(0, 20)
          .map((e) => e.fees!.totalFeeStroops);

        if (recent.length === 0) return;

        const sorted = [...recent].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        const median =
          sorted.length % 2 !== 0
            ? sorted[mid]
            : (sorted[mid - 1] + sorted[mid]) / 2;

        set({ recentFeeMedianStroops: median });
      },
    }),
    {
      name: "zenith-tracker",
      partialize: (s) => ({
        entries: s.entries,
        recentFeeMedianStroops: s.recentFeeMedianStroops,
      }),
      skipHydration: true,
    }
  )
);

// ---------------------------------------------------------------------------
// Helper: wire pipeline events into the tracker store
// ---------------------------------------------------------------------------

export function createPipelineEventHandler(
  txId: string,
  label: string,
  retryParams?: SerializedRetryParams
) {
  const store = useTrackerStore.getState();

  // Create entry immediately
  store.upsertEntry({
    txId,
    label,
    stage: "building",
    retryParams,
    startedAt: Date.now(),
    elapsedMs: 0,
    dismissed: false,
    toastShown: false,
  });

  return (event: import("../soroban/types").PipelineEvent) => {
    useTrackerStore.getState().upsertEntry({
      txId: event.txId,
      stage: event.stage,
      hash: event.hash,
      fees: event.fees,
      returnValue: event.returnValue,
      error: event.error,
      humanError: event.humanError,
      assembledXdr: event.assembledXdr,
      elapsedMs: event.elapsedMs,
      label,
      retryParams,
    });
  };
}

// ---------------------------------------------------------------------------
// explorerUrl re-export for convenience in components
// ---------------------------------------------------------------------------
export { explorerUrl };
