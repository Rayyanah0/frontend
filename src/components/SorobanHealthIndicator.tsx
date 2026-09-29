/**
 * SorobanHealthIndicator — Issue #67.
 *
 * Shows RPC reachability + latest ledger age as a compact status chip,
 * designed to sit next to the existing feed-status indicators in AppHeader.
 */
"use client";

import { useSoroban } from "../lib/soroban/useSoroban";

function ledgerAgeLabel(ms: number): string {
  if (!isFinite(ms)) return "—";
  if (ms < 1000) return "<1s";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

const STATUS_DOT: Record<string, string> = {
  healthy:     "var(--call)",
  degraded:    "var(--atm)",
  unreachable: "var(--put)",
};

export function SorobanHealthIndicator() {
  const { health, healthLoading, network } = useSoroban();

  const status = health?.status ?? (healthLoading ? "checking" : "unreachable");
  const dotColor = status === "checking" ? "var(--text-lo)" : STATUS_DOT[status] ?? "var(--text-lo)";

  return (
    <div
      title={`Soroban ${network.displayName} · ledger ${health?.latestLedger ?? "—"} · age ${ledgerAgeLabel(health?.ledgerAgeMs ?? Infinity)}`}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        cursor: "default",
      }}
    >
      <div style={{
        width: 5, height: 5, borderRadius: "50%",
        background: dotColor,
        boxShadow: status === "healthy" ? `0 0 4px ${dotColor}` : undefined,
        transition: "background 400ms",
      }} />
      <span style={{ fontSize: 10, color: "var(--text-lo)", whiteSpace: "nowrap" }}>
        {status === "checking" ? "RPC…" : (
          <>
            Soroban{" "}
            {health && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                #{health.latestLedger} · {ledgerAgeLabel(health.ledgerAgeMs)} ago
              </span>
            )}
          </>
        )}
      </span>
    </div>
  );
}
