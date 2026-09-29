/**
 * On-chain position reconciliation.
 *
 * Fetches the user's open positions directly from the Zenith contract
 * state (via the backend's /api/v1/onchain/positions proxy, which calls
 * the Soroban RPC for us so the browser doesn't need to speak XDR) and
 * diffs them against the backend's position list.
 *
 * Discrepancy categories:
 *   "missing"   — in contract state but not in the backend (indexer missed it)
 *   "extra"     — in the backend but not in the contract (indexer has stale data)
 *   "mismatch"  — in both but size/strike/collateral differ
 *
 * Severity:
 *   "critical"  — financial impact: size or collateral is wrong
 *   "warning"   — non-financial: only strike or option-type label differs
 *   "info"      — purely informational (e.g. a dust difference in collateral)
 */

import { apiGet } from "./client";
import type { Position } from "./types";

// ---------------------------------------------------------------------------
// On-chain position shape (mirrors what the Soroban contract stores)
// ---------------------------------------------------------------------------

export interface OnChainPosition {
  /** Same ID scheme as the backend — used as the diff key. */
  id: string;
  underlying: string;
  strike: number;
  expiry_days: number;
  option_type: "call" | "put";
  position_type: "long" | "short";
  contracts: number;
  collateral: number;
  /** Stellar ledger sequence number where this position was opened. */
  ledger: number;
}

// ---------------------------------------------------------------------------
// Discrepancy types
// ---------------------------------------------------------------------------

export type DiscrepancyKind = "missing" | "extra" | "mismatch";
export type DiscrepancySeverity = "critical" | "warning" | "info";

export interface PositionDiscrepancy {
  kind: DiscrepancyKind;
  severity: DiscrepancySeverity;
  positionId: string;
  /** Populated when the discrepancy concerns a known backend position. */
  backendPosition?: Position;
  /** Populated when the discrepancy concerns a known on-chain position. */
  onChainPosition?: OnChainPosition;
  /** Human-readable description. */
  description: string;
  /** Horizon explorer link for the position's opening tx (if known). */
  ledgerUrl?: string;
}

// ---------------------------------------------------------------------------
// Fetch on-chain positions
// ---------------------------------------------------------------------------

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet";

export async function fetchOnChainPositions(
  address: string,
  token: string
): Promise<OnChainPosition[]> {
  // The backend proxies the Soroban RPC call and returns the positions
  // as JSON so the browser doesn't need to handle XDR decoding.
  return apiGet<OnChainPosition[]>(
    `/api/v1/onchain/positions?wallet_address=${encodeURIComponent(address)}`,
    token
  );
}

// ---------------------------------------------------------------------------
// Reconciliation logic
// ---------------------------------------------------------------------------

/** Numeric tolerance for size/collateral comparisons (floating-point noise). */
const NUMERIC_TOLERANCE = 0.001;

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) <= NUMERIC_TOLERANCE;
}

export function reconcilePositions(
  backendPositions: Position[],
  onChainPositions: OnChainPosition[]
): PositionDiscrepancy[] {
  const discrepancies: PositionDiscrepancy[] = [];

  const backendById = new Map(backendPositions.map((p) => [p.id, p]));
  const onChainById = new Map(onChainPositions.map((p) => [p.id, p]));

  // 1. Find "missing": on-chain but not in backend.
  Array.from(onChainById.entries()).forEach(([id, oc]) => {
    if (!backendById.has(id)) {
      discrepancies.push({
        kind: "missing",
        severity: "critical",
        positionId: id,
        onChainPosition: oc,
        description:
          `Position ${id} exists on-chain (${oc.contracts} × ${oc.underlying} ${oc.strike} ${oc.option_type}) but is missing from the backend indexer.`,
        ledgerUrl: `${EXPLORER_BASE}/ledger/${oc.ledger}`,
      });
    }
  });

  // 2. Find "extra": in backend but not on-chain.
  Array.from(backendById.entries()).forEach(([id, bp]) => {
    if (!onChainById.has(id)) {
      discrepancies.push({
        kind: "extra",
        severity: "critical",
        positionId: id,
        backendPosition: bp,
        description:
          `Position ${id} is in the backend (${bp.contracts} × ${bp.underlying} ${bp.strike} ${bp.option_type}) but not found on-chain.`,
      });
    }
  });

  // 3. Find "mismatch": in both but values differ.
  Array.from(backendById.entries()).forEach(([id, bp]) => {
    const oc = onChainById.get(id);
    if (!oc) return; // already handled above

    const issues: string[] = [];
    let severity: DiscrepancySeverity = "info";

    if (!approxEq(oc.contracts, bp.contracts)) {
      issues.push(`contracts: on-chain ${oc.contracts}, backend ${bp.contracts}`);
      severity = "critical";
    }
    if (!approxEq(oc.collateral, bp.collateral)) {
      issues.push(
        `collateral: on-chain ${oc.collateral.toFixed(4)}, backend ${bp.collateral.toFixed(4)}`
      );
      if (severity !== "critical") severity = "critical";
    }
    if (oc.strike !== bp.strike) {
      issues.push(`strike: on-chain ${oc.strike}, backend ${bp.strike}`);
      if (severity === "info") severity = "warning";
    }
    if (oc.option_type !== bp.option_type) {
      issues.push(`type: on-chain ${oc.option_type}, backend ${bp.option_type}`);
      if (severity === "info") severity = "warning";
    }

    if (issues.length > 0) {
      discrepancies.push({
        kind: "mismatch",
        severity,
        positionId: id,
        backendPosition: bp,
        onChainPosition: oc,
        description: `Position ${id} mismatches — ${issues.join("; ")}.`,
        ledgerUrl: `${EXPLORER_BASE}/ledger/${oc.ledger}`,
      });
    }
  });

  return discrepancies;
}

// ---------------------------------------------------------------------------
// Monitoring report (no PII beyond wallet address hash)
// ---------------------------------------------------------------------------

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function sendDiscrepancyReport(
  address: string,
  discrepancies: PositionDiscrepancy[]
): Promise<void> {
  if (discrepancies.length === 0) return;

  const addressHash = await sha256Hex(address).catch(() => "unknown");
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8081";

  await fetch(`${apiBase}/api/v1/onchain/reconciliation-report`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet_address_hash: addressHash,
      discrepancy_count: discrepancies.length,
      discrepancies: discrepancies.map((d) => ({
        kind: d.kind,
        severity: d.severity,
        position_id: d.positionId,
        description: d.description,
      })),
      reported_at: new Date().toISOString(),
    }),
  }).catch(() => {
    // Monitoring reports are best-effort — never throw back to the UI.
  });
}
