"use client";

import { useEffect, useState } from "react";
import {
  useTrackerStore,
  STAGE_ORDER,
  stageIndex,
  isTerminalStage,
  explorerUrl,
  type TrackerEntry,
} from "../lib/store/tracker";
import type { PipelineStage } from "../lib/soroban/types";

// ---------------------------------------------------------------------------
// Stage labels and colors for the stepper
// ---------------------------------------------------------------------------

const STAGE_LABELS: Record<PipelineStage, string> = {
  building: "Building",
  simulating: "Simulating",
  awaiting_signature: "Sign",
  submitting: "Submitting",
  pending: "Pending",
  success: "Confirmed",
  failed: "Failed",
  cancelled: "Cancelled",
};

function stageColor(stage: PipelineStage): string {
  if (stage === "success") return "var(--call)";
  if (stage === "failed" || stage === "cancelled") return "var(--put)";
  return "var(--brand)";
}

function elapsed(entry: TrackerEntry): string {
  const ms = entry.finishedAt
    ? entry.finishedAt - entry.startedAt
    : Date.now() - entry.startedAt;
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Stepper component for a single transaction
// ---------------------------------------------------------------------------

function TxStepper({ entry }: { entry: TrackerEntry }) {
  const currentIdx = stageIndex(entry.stage);
  const isFailed = entry.stage === "failed" || entry.stage === "cancelled";

  return (
    <div style={{ display: "flex", gap: 0, alignItems: "center", marginTop: 8, marginBottom: 4 }}>
      {STAGE_ORDER.map((stage, idx) => {
        const isActive = idx === currentIdx;
        const isPast = isFailed ? false : currentIdx > idx;
        const isSuccess = entry.stage === "success" && idx <= currentIdx;

        const dotColor = isSuccess || isPast
          ? "var(--call)"
          : isActive && isFailed
            ? "var(--put)"
            : isActive
              ? "var(--brand)"
              : "var(--border-default)";

        return (
          <div key={stage} style={{ display: "flex", alignItems: "center", flex: idx < STAGE_ORDER.length - 1 ? 1 : 0 }}>
            {/* Dot */}
            <div
              aria-label={STAGE_LABELS[stage]}
              title={STAGE_LABELS[stage]}
              style={{
                width: 8, height: 8, borderRadius: "50%",
                background: dotColor,
                border: isActive ? `2px solid ${dotColor}` : `2px solid ${dotColor}`,
                flexShrink: 0,
                boxShadow: isActive && !isFailed ? `0 0 0 3px rgba(181,150,101,0.2)` : undefined,
                transition: "all 200ms",
              }}
            />
            {/* Connector line */}
            {idx < STAGE_ORDER.length - 1 && (
              <div style={{
                flex: 1, height: 1,
                background: isPast || isSuccess ? "var(--call)" : "var(--border-subtle)",
                transition: "background 300ms",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single transaction entry card
// ---------------------------------------------------------------------------

function TxCard({ entry }: { entry: TrackerEntry }) {
  const { dismiss } = useTrackerStore();
  const [copied, setCopied] = useState(false);
  const [errExpanded, setErrExpanded] = useState(false);

  const copyHash = () => {
    if (!entry.hash) return;
    navigator.clipboard.writeText(entry.hash).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const isTerminal = isTerminalStage(entry.stage);
  const isFailed = entry.stage === "failed" || entry.stage === "cancelled";

  return (
    <div style={{
      padding: "12px 14px",
      borderBottom: "1px solid var(--border-subtle)",
      background: "var(--bg-raised)",
    }}>
      {/* Title row */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)", marginBottom: 1 }}>
            {entry.label}
          </div>
          {entry.description && (
            <div style={{ fontSize: 10, color: "var(--text-lo)" }}>{entry.description}</div>
          )}
        </div>

        {/* Status badge + elapsed */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: "2px 6px",
            background: isFailed ? "var(--put-dim)" : isTerminal ? "var(--call-dim)" : "var(--brand-dim)",
            color: stageColor(entry.stage),
            textTransform: "uppercase", letterSpacing: "0.06em",
          }}>
            {STAGE_LABELS[entry.stage]}
          </span>
          <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>
            {elapsed(entry)}
          </span>
        </div>

        {/* Dismiss (only for terminal states) */}
        {isTerminal && (
          <button
            onClick={() => dismiss(entry.txId)}
            aria-label="Dismiss transaction"
            style={{
              background: "none", border: "none", color: "var(--text-lo)",
              fontSize: 16, cursor: "pointer", lineHeight: 1, padding: 2, flexShrink: 0,
            }}
          >×</button>
        )}
      </div>

      {/* Stepper */}
      <TxStepper entry={entry} />

      {/* Stage label row */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2, marginBottom: 4 }}>
        {STAGE_ORDER.map((s) => (
          <span key={s} style={{
            fontSize: 8, color: s === entry.stage ? "var(--text-mid)" : "var(--text-lo)",
            textTransform: "uppercase", letterSpacing: "0.04em",
          }}>
            {STAGE_LABELS[s].slice(0, 4)}
          </span>
        ))}
      </div>

      {/* Fee summary (if available) */}
      {entry.fees && (
        <div style={{
          marginTop: 6, padding: "4px 8px", background: "var(--bg-overlay)",
          fontSize: 10, display: "flex", gap: 12, color: "var(--text-lo)",
        }}>
          <span>Fee: <span className="num" style={{ color: "var(--text-mid)" }}>
            {entry.fees.totalFeeXlm.toFixed(6)} XLM
          </span></span>
          {entry.fees.totalFeeUsd !== null && (
            <span className="num" style={{ color: "var(--text-lo)" }}>
              ≈ ${entry.fees.totalFeeUsd.toFixed(5)}
            </span>
          )}
        </div>
      )}

      {/* Hash row */}
      {entry.hash && (
        <div style={{
          marginTop: 6, display: "flex", alignItems: "center", gap: 6,
          padding: "4px 8px", background: "var(--bg-overlay)",
        }}>
          <span className="num" style={{ fontSize: 10, color: "var(--text-lo)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.hash.slice(0, 8)}…{entry.hash.slice(-8)}
          </span>
          <button
            onClick={copyHash}
            aria-label="Copy transaction hash"
            title="Copy hash"
            style={{
              background: "none", border: "none", fontSize: 11, cursor: "pointer",
              color: copied ? "var(--call)" : "var(--text-lo)", padding: 0, flexShrink: 0,
            }}
          >
            {copied ? "✓" : "⎘"}
          </button>
          <a
            href={explorerUrl(entry.hash)}
            target="_blank"
            rel="noreferrer"
            aria-label="View on Stellar Explorer"
            title="View on explorer"
            style={{ fontSize: 10, color: "var(--brand)", textDecoration: "none", flexShrink: 0 }}
          >
            Explorer ↗
          </a>
        </div>
      )}

      {/* Error row */}
      {isFailed && entry.humanError && (
        <div style={{ marginTop: 6 }}>
          <div style={{
            padding: "6px 8px", background: "var(--put-dim)",
            border: "1px solid rgba(182,86,64,0.2)", fontSize: 11, color: "var(--put)",
          }}>
            {entry.humanError}
            {entry.error && entry.error !== entry.humanError && (
              <button
                onClick={() => setErrExpanded((x) => !x)}
                style={{
                  marginLeft: 8, background: "none", border: "none",
                  fontSize: 10, color: "var(--put)", cursor: "pointer", opacity: 0.8,
                }}
              >
                {errExpanded ? "Hide raw" : "Raw error"}
              </button>
            )}
          </div>
          {errExpanded && entry.error && (
            <div style={{
              padding: "6px 8px", background: "var(--bg-overlay)",
              border: "1px solid var(--border-subtle)", fontSize: 9,
              fontFamily: "var(--font-mono)", color: "var(--text-lo)",
              wordBreak: "break-all", marginTop: 2,
            }}>
              {entry.error}
            </div>
          )}
        </div>
      )}

      {/* Recovery actions */}
      {isFailed && entry.retryParams && (
        <div style={{ marginTop: 8, display: "flex", gap: 6 }}>
          <RetryButton entry={entry} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Retry button — rebuilds from stored params
// ---------------------------------------------------------------------------

function RetryButton({ entry }: { entry: TrackerEntry }) {
  const [retrying, setRetrying] = useState(false);

  const handleRetry = async () => {
    if (!entry.retryParams) return;
    setRetrying(true);
    try {
      // Dynamically import to avoid circular deps
      const [{ executeContractCall }, { useWalletStore }] = await Promise.all([
        import("../lib/soroban/pipeline"),
        import("../lib/store/wallet"),
      ]);
      const { createPipelineEventHandler } = await import("../lib/store/tracker");

      const signer = useWalletStore.getState().getSigner();
      const retryParams = entry.retryParams!;
      let args: unknown[] = [];
      try { args = JSON.parse(retryParams.argsJson); } catch { /* use empty */ }

      const handler = createPipelineEventHandler(
        `${entry.txId}-retry-${Date.now()}`,
        retryParams.label,
        retryParams
      );

      await executeContractCall(
        {
          contract: retryParams.contract,
          method: retryParams.method,
          args,
          signer,
          priority: retryParams.priority,
          meta: retryParams.meta,
        },
        handler
      );
    } catch {
      // Error is captured in tracker
    } finally {
      setRetrying(false);
    }
  };

  return (
    <button
      onClick={handleRetry}
      disabled={retrying}
      aria-label="Retry transaction"
      style={{
        padding: "4px 10px", fontSize: 11, fontWeight: 600, cursor: retrying ? "default" : "pointer",
        background: "none", border: "1px solid var(--border-default)",
        color: "var(--text-mid)", opacity: retrying ? 0.5 : 1,
      }}
    >
      {retrying ? "Retrying…" : "↺ Retry"}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Transaction Tracker Drawer
// ---------------------------------------------------------------------------

export function TransactionTracker() {
  const { drawerOpen, setDrawerOpen, visibleEntries, clearDismissed } = useTrackerStore();
  const entries = visibleEntries();

  // Live timer: force re-renders for in-flight entries
  const [, setTick] = useState(0);
  useEffect(() => {
    const inFlight = entries.some((e) => !isTerminalStage(e.stage));
    if (!inFlight) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [entries]);

  useEffect(() => {
    if (!drawerOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setDrawerOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen, setDrawerOpen]);

  if (!drawerOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={() => setDrawerOpen(false)}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 150 }}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Transaction tracker"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 380,
          background: "var(--bg-elevated)", borderLeft: "1px solid var(--border-default)",
          zIndex: 151, display: "flex", flexDirection: "column", overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "12px 16px", borderBottom: "1px solid var(--border-default)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexShrink: 0,
        }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--text-hi)" }}>
              Transactions
            </div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 1 }}>
              {entries.length === 0 ? "No transactions" : `${entries.length} transaction${entries.length !== 1 ? "s" : ""}`}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {entries.some((e) => isTerminalStage(e.stage)) && (
              <button
                onClick={clearDismissed}
                style={{
                  background: "none", border: "none", fontSize: 10, color: "var(--text-lo)",
                  cursor: "pointer", padding: "2px 6px",
                }}
              >
                Clear all
              </button>
            )}
            <button
              onClick={() => setDrawerOpen(false)}
              aria-label="Close transaction tracker"
              style={{
                background: "none", border: "none", fontSize: 20, color: "var(--text-lo)",
                cursor: "pointer", lineHeight: 1, padding: 4,
              }}
            >×</button>
          </div>
        </div>

        {/* Entries list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {entries.length === 0 ? (
            <div style={{
              display: "flex", flexDirection: "column", alignItems: "center",
              justifyContent: "center", height: "100%", gap: 8,
              color: "var(--text-lo)", fontSize: 12,
            }}>
              <span style={{ fontSize: 24, opacity: 0.3 }}>⛓</span>
              No on-chain transactions yet
            </div>
          ) : (
            entries.map((entry) => <TxCard key={entry.txId} entry={entry} />)
          )}
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Header indicator button (mounted in AppHeader)
// ---------------------------------------------------------------------------

export function TrackerHeaderButton() {
  const { toggleDrawer, drawerOpen } = useTrackerStore();
  const entries = useTrackerStore((s) => s.entries);
  const inFlight = entries.filter((e) => !isTerminalStage(e.stage) && !e.dismissed).length;
  const failed = entries.filter((e) => e.stage === "failed" && !e.dismissed).length;

  // Pulse animation for in-flight
  const [pulse, setPulse] = useState(false);
  useEffect(() => {
    if (inFlight === 0) return;
    const t = setInterval(() => setPulse((p) => !p), 900);
    return () => clearInterval(t);
  }, [inFlight]);

  const dotColor = failed > 0 ? "var(--put)" : inFlight > 0 ? "var(--brand)" : "var(--call)";
  const totalActive = inFlight + failed;

  if (entries.length === 0 && !drawerOpen) return null;

  return (
    <button
      onClick={toggleDrawer}
      aria-label={`Transaction tracker${totalActive > 0 ? `, ${totalActive} active` : ""}`}
      title="Transaction history"
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 10px",
        background: drawerOpen ? "var(--bg-overlay)" : "transparent",
        border: "1px solid var(--border-default)", cursor: "pointer",
        fontSize: 11, color: "var(--text-mid)",
      }}
    >
      <span style={{
        width: 6, height: 6, borderRadius: "50%", background: dotColor,
        opacity: inFlight > 0 && pulse ? 0.5 : 1,
        transition: "opacity 400ms",
        flexShrink: 0,
      }} />
      Txns
      {totalActive > 0 && (
        <span style={{
          fontSize: 10, fontWeight: 700,
          background: failed > 0 ? "var(--put)" : "var(--brand)",
          color: "var(--bg)",
          padding: "0px 4px", minWidth: 14, textAlign: "center",
        }}>
          {totalActive}
        </span>
      )}
    </button>
  );
}
