"use client";

import { useState } from "react";
import type { SorobanFeeBreakdown } from "../lib/soroban/types";
import { useTrackerStore } from "../lib/store/tracker";

const STROOPS_PER_XLM = 10_000_000;

// Anomaly threshold: warn if fee > 5× the recent median
const ANOMALY_MULTIPLIER = 5;

function fmtStroops(s: number): string {
  if (s === 0) return "0";
  if (s < 1000) return `${s} str`;
  return `${(s / 1000).toFixed(1)}k str`;
}

function fmtXlm(xlm: number): string {
  if (xlm === 0) return "0 XLM";
  if (xlm < 0.001) return `<0.001 XLM`;
  return `${xlm.toFixed(6)} XLM`;
}

function fmtUsd(usd: number | null): string {
  if (usd === null) return "";
  if (usd < 0.00001) return "< $0.00001";
  return `≈ $${usd.toFixed(5)}`;
}

interface BreakdownRowProps {
  label: string;
  stroops: number;
  dimLabel?: string;
}

function BreakdownRow({ label, stroops, dimLabel }: BreakdownRowProps) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "center",
      padding: "3px 0", fontSize: 11,
    }}>
      <span style={{ color: "var(--text-lo)" }}>
        {label}
        {dimLabel && (
          <span style={{ marginLeft: 6, fontSize: 10, color: "var(--text-lo)", opacity: 0.7 }}>
            {dimLabel}
          </span>
        )}
      </span>
      <span className="num" style={{ color: "var(--text-mid)" }}>{fmtStroops(stroops)}</span>
    </div>
  );
}

interface FeeSurfaceProps {
  fees: SorobanFeeBreakdown;
  /** Current XLM balance of the signer (for reserve warning) */
  xlmBalance?: number;
  /** Callback when priority changes */
  onPriorityChange?: (priority: "standard" | "fast") => void;
}

export function FeeSurface({ fees, xlmBalance, onPriorityChange }: FeeSurfaceProps) {
  const [expanded, setExpanded] = useState(false);
  const recentMedian = useTrackerStore((s) => s.recentFeeMedianStroops);

  // Anomaly detection
  const isAnomalous =
    recentMedian !== null &&
    recentMedian > 0 &&
    fees.totalFeeStroops > recentMedian * ANOMALY_MULTIPLIER;

  // Reserve check: XLM balance must cover fee + 1 XLM base reserve
  const BASE_RESERVE_XLM = 1;
  const requiredXlm = fees.totalFeeXlm + BASE_RESERVE_XLM;
  const insufficientBalance =
    xlmBalance !== undefined && xlmBalance < requiredXlm;

  return (
    <div style={{
      border: "1px solid var(--border-default)", background: "var(--bg-overlay)",
      padding: "10px 12px", marginTop: 8,
    }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>
          Transaction Fee
        </div>
        {/* Priority selector */}
        {onPriorityChange && (
          <div style={{ display: "flex", gap: 1 }}>
            {(["standard", "fast"] as const).map((p) => (
              <button
                key={p}
                onClick={() => onPriorityChange(p)}
                title={p === "standard" ? "Base network fee" : "2× inclusion fee — faster inclusion in congested periods"}
                aria-label={`Set fee priority to ${p}`}
                style={{
                  padding: "2px 8px", border: "1px solid var(--border-default)",
                  background: fees.priority === p ? "var(--brand)" : "transparent",
                  color: fees.priority === p ? "var(--bg)" : "var(--text-lo)",
                  fontSize: 10, fontWeight: 600, cursor: "pointer",
                  textTransform: "capitalize",
                }}
              >{p}</button>
            ))}
          </div>
        )}
      </div>

      {/* Total cost summary */}
      <div style={{ display: "flex", gap: 16, alignItems: "baseline", marginBottom: 6 }}>
        <div>
          <span className="num" style={{ fontSize: 14, fontWeight: 600, color: "var(--text-hi)" }}>
            {fmtXlm(fees.totalFeeXlm)}
          </span>
          {fees.totalFeeUsd !== null && (
            <span className="num" style={{ fontSize: 11, color: "var(--text-lo)", marginLeft: 8 }}>
              {fmtUsd(fees.totalFeeUsd)}
              {fees.xlmUsdPrice !== null && (
                <span style={{ fontSize: 9, marginLeft: 4, opacity: 0.7 }}>
                  @ ${fees.xlmUsdPrice.toFixed(4)}/XLM
                </span>
              )}
            </span>
          )}
        </div>
        <span style={{
          fontSize: 10, padding: "1px 6px",
          background: fees.priority === "fast" ? "rgba(181,150,101,0.15)" : "var(--bg-elevated)",
          border: "1px solid var(--border-subtle)",
          color: fees.priority === "fast" ? "var(--brand)" : "var(--text-lo)",
        }}>
          {fees.priority === "fast" ? "Fast" : "Standard"}
          {fees.priority === "fast" && (
            <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>2× inclusion</span>
          )}
        </span>
      </div>

      {/* Warnings */}
      {isAnomalous && (
        <div style={{
          marginBottom: 8, padding: "6px 8px", fontSize: 11,
          background: "rgba(182,86,64,0.12)", border: "1px solid rgba(182,86,64,0.25)",
          color: "var(--put)",
        }}>
          ⚠ Fee is {(fees.totalFeeStroops / recentMedian!).toFixed(1)}× the recent median — verify before signing.
        </div>
      )}
      {insufficientBalance && (
        <div style={{
          marginBottom: 8, padding: "6px 8px", fontSize: 11,
          background: "rgba(182,86,64,0.12)", border: "1px solid rgba(182,86,64,0.25)",
          color: "var(--put)",
        }}>
          ⚠ Insufficient XLM balance for fees + reserves (need {requiredXlm.toFixed(4)} XLM, have {xlmBalance!.toFixed(4)} XLM).
        </div>
      )}

      {/* Top-level breakdown (always visible) */}
      <div style={{ borderTop: "1px solid var(--border-subtle)", paddingTop: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
          <span style={{ color: "var(--text-lo)" }}>Inclusion fee</span>
          <span className="num" style={{ color: "var(--text-mid)" }}>
            {fmtStroops(fees.inclusionFeeStroops)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
          <span style={{ color: "var(--text-lo)" }}>Resource fee</span>
          <span className="num" style={{ color: "var(--text-mid)" }}>
            {fmtStroops(fees.resourceFeeStroops)}
          </span>
        </div>
      </div>

      {/* Expandable detailed breakdown */}
      <button
        onClick={() => setExpanded((x) => !x)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse fee details" : "Expand fee details"}
        style={{
          display: "flex", alignItems: "center", gap: 4, marginTop: 6,
          background: "none", border: "none", cursor: "pointer",
          fontSize: 10, color: "var(--text-lo)", padding: 0,
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}
      >
        <span style={{
          display: "inline-block",
          transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
          transition: "transform 150ms",
          fontSize: 10,
        }}>▶</span>
        {expanded ? "Hide" : "Show"} detailed breakdown
      </button>

      {expanded && (
        <div style={{
          marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-subtle)",
        }}>
          <div style={{
            fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em",
            color: "var(--text-lo)", marginBottom: 4,
          }}>
            Resource Fee Breakdown
          </div>

          <BreakdownRow
            label="CPU instructions"
            stroops={fees.cpuInstructionFeeStroops}
            dimLabel={fees.cpuInstructions > 0 ? `${fees.cpuInstructions.toLocaleString()} ops` : undefined}
          />
          <BreakdownRow
            label="Read bytes"
            stroops={fees.readBytesFeeStroops}
            dimLabel={fees.readBytes > 0 ? `${fees.readBytes.toLocaleString()} B` : undefined}
          />
          <BreakdownRow
            label="Write bytes"
            stroops={fees.writeBytesFeeStroops}
            dimLabel={fees.writeBytes > 0 ? `${fees.writeBytes.toLocaleString()} B` : undefined}
          />
          <BreakdownRow
            label="Ledger reads"
            stroops={fees.ledgerReadFeeStroops}
            dimLabel={fees.ledgerReadsCount > 0 ? `${fees.ledgerReadsCount} entries` : undefined}
          />
          <BreakdownRow
            label="Ledger writes"
            stroops={fees.ledgerWriteFeeStroops}
            dimLabel={fees.ledgerWritesCount > 0 ? `${fees.ledgerWritesCount} entries` : undefined}
          />
          {fees.rentFeeStroops > 0 && (
            <BreakdownRow
              label="Rent (new entries)"
              stroops={fees.rentFeeStroops}
            />
          )}

          {/* Total check row */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            padding: "5px 0 0", marginTop: 4, borderTop: "1px solid var(--border-subtle)",
            fontSize: 11, fontWeight: 600,
          }}>
            <span style={{ color: "var(--text-mid)" }}>Total</span>
            <span className="num" style={{ color: "var(--text-hi)" }}>
              {fmtStroops(fees.totalFeeStroops)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
