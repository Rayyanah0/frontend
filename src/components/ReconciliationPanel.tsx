"use client";

import { usePositionReconciliation } from "../lib/hooks/usePositionReconciliation";
import type { Position } from "../lib/api/types";
import type { PositionDiscrepancy } from "../lib/api/reconciliation";

interface ReconciliationPanelProps {
  positions: Position[];
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "var(--put)",
  warning: "var(--atm)",
  info: "var(--text-mid)",
};

const KIND_LABEL: Record<string, string> = {
  missing: "Missing from indexer",
  extra: "Extra in indexer",
  mismatch: "Value mismatch",
};

function DiscrepancyRow({ d }: { d: PositionDiscrepancy }) {
  return (
    <div
      style={{
        padding: "8px 10px",
        background: "var(--bg-overlay)",
        border: `1px solid ${SEVERITY_COLOR[d.severity]}33`,
        borderLeft: `3px solid ${SEVERITY_COLOR[d.severity]}`,
        display: "flex",
        flexDirection: "column",
        gap: 3,
        marginBottom: 6,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: SEVERITY_COLOR[d.severity],
            background: `${SEVERITY_COLOR[d.severity]}22`,
            padding: "1px 5px",
          }}
        >
          {d.severity}
        </span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "var(--text-mid)",
          }}
        >
          {KIND_LABEL[d.kind]}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            color: "var(--text-lo)",
            marginLeft: "auto",
          }}
        >
          {d.positionId.slice(0, 12)}…
        </span>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-mid)" }}>{d.description}</div>
      {d.ledgerUrl && (
        <a
          href={d.ledgerUrl}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 10, color: "var(--text-lo)" }}
        >
          View ledger entry ↗
        </a>
      )}
    </div>
  );
}

/**
 * Shows per-position verification badges and a collapsible discrepancy
 * report panel.  Designed to be embedded in the portfolio page alongside
 * the position table.
 */
export function ReconciliationPanel({ positions }: ReconciliationPanelProps) {
  const { discrepancies, verifiedIds, loading, error, lastChecked, refresh } =
    usePositionReconciliation(positions);

  const criticalCount = discrepancies.filter(
    (d) => d.severity === "critical"
  ).length;
  const warningCount = discrepancies.filter(
    (d) => d.severity === "warning"
  ).length;

  return (
    <div
      style={{
        background: "var(--bg-raised)",
        border: "1px solid var(--border-default)",
        padding: 14,
        fontSize: 12,
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, color: "var(--text-hi)" }}>
          On-chain Reconciliation
        </span>

        {/* Summary chips */}
        {!loading && (
          <>
            <span
              style={{
                fontSize: 11,
                padding: "1px 7px",
                background: "var(--call-dim)",
                color: "var(--call)",
                border: "1px solid var(--call)",
              }}
            >
              {verifiedIds.size} verified
            </span>
            {criticalCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  background: "var(--put-dim)",
                  color: "var(--put)",
                  border: "1px solid var(--put)",
                }}
              >
                {criticalCount} critical
              </span>
            )}
            {warningCount > 0 && (
              <span
                style={{
                  fontSize: 11,
                  padding: "1px 7px",
                  background: "var(--atm-dim)",
                  color: "var(--atm)",
                  border: "1px solid var(--atm)",
                }}
              >
                {warningCount} warning
              </span>
            )}
          </>
        )}

        <button
          onClick={refresh}
          disabled={loading}
          aria-label="Re-run reconciliation"
          style={{
            marginLeft: "auto",
            background: "none",
            border: "none",
            cursor: loading ? "default" : "pointer",
            fontSize: 11,
            color: loading ? "var(--text-lo)" : "var(--text-mid)",
            padding: 0,
          }}
        >
          {loading ? "Checking…" : "↺ Re-check"}
        </button>
      </div>

      {lastChecked && (
        <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
          Last checked:{" "}
          {lastChecked.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })}
        </div>
      )}

      {error && (
        <div
          style={{
            fontSize: 11,
            color: "var(--atm)",
            padding: "6px 8px",
            background: "var(--atm-dim)",
            border: "1px solid var(--atm)",
            marginBottom: 8,
          }}
        >
          ⚠ {error} — reconciliation unavailable until the on-chain endpoint is reachable.
        </div>
      )}

      {/* Per-position verification summary */}
      {positions.length > 0 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 6,
            marginBottom: 10,
          }}
        >
          {positions.map((p) => {
            const isVerified = verifiedIds.has(p.id);
            const hasDisc = discrepancies.some((d) => d.positionId === p.id);
            const severity = discrepancies.find((d) => d.positionId === p.id)?.severity;
            const color = isVerified
              ? "var(--call)"
              : hasDisc
              ? SEVERITY_COLOR[severity ?? "info"]
              : "var(--text-lo)";
            const label = isVerified
              ? "✓ Verified on-chain"
              : hasDisc
              ? `⚠ ${KIND_LABEL[discrepancies.find((d) => d.positionId === p.id)!.kind]}`
              : "○ Not yet checked";
            return (
              <div
                key={p.id}
                title={label}
                style={{
                  fontSize: 10,
                  padding: "2px 7px",
                  border: `1px solid ${color}55`,
                  color,
                  fontFamily: "var(--font-mono)",
                }}
              >
                {p.underlying} {p.strike} {p.option_type}{" "}
                {isVerified && (
                  <span style={{ marginLeft: 3 }} aria-label="Verified on-chain">
                    ✓
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Discrepancy list */}
      {discrepancies.length > 0 ? (
        <div>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              color: "var(--text-lo)",
              marginBottom: 6,
            }}
          >
            Discrepancy report ({discrepancies.length})
          </div>
          {discrepancies.map((d) => (
            <DiscrepancyRow key={`${d.kind}-${d.positionId}`} d={d} />
          ))}
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 4 }}>
            A report (wallet address hashed, no PII) has been sent to monitoring.
          </div>
        </div>
      ) : (
        !loading &&
        !error &&
        positions.length > 0 && (
          <div
            style={{
              fontSize: 11,
              color: "var(--call)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <span>✓</span>
            <span>All positions verified on-chain — no discrepancies.</span>
          </div>
        )
      )}

      {positions.length === 0 && !loading && (
        <div style={{ fontSize: 11, color: "var(--text-lo)" }}>
          No open positions to reconcile.
        </div>
      )}
    </div>
  );
}
