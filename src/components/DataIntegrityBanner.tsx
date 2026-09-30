"use client";

/**
 * DataIntegrityBanner — per-symbol market-data integrity warning banner.
 *
 * Shows when a symbol has ≥ CONSECUTIVE_REJECT_THRESHOLD consecutive rejected
 * ticks (status === "doubt").  Mount this at the top of the options chain or
 * any trading panel that accepts a `sym` prop.
 *
 * The banner is dismissible per session (stores the dismissed symbol set in
 * component state — deliberately not persisted so it re-appears after a fresh
 * page load, ensuring users don't permanently suppress a safety warning).
 *
 * Resets: the banner re-appears automatically once the feed recovers and the
 * symbol's status returns to "ok" (the dismissed set is cleared on recovery).
 */

import { useEffect, useState } from "react";
import { useIntegrityStore, CONSECUTIVE_REJECT_THRESHOLD } from "../../lib/integrity/integrityStore";

interface Props {
  /** The symbol to show the banner for (e.g. "BTC"). Pass null to show for any "doubt" symbol. */
  sym?: string;
}

export function DataIntegrityBanner({ sym }: Props) {
  const symbols = useIntegrityStore((s) => s.symbols);

  // Collect symbols that are currently in "doubt".
  const doubtSymbols = sym
    ? symbols[sym]?.status === "doubt" ? [sym] : []
    : Object.entries(symbols)
        .filter(([, s]) => s.status === "doubt")
        .map(([k]) => k);

  // Per-session dismiss set.  Cleared when the symbol recovers.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  // Auto-clear dismissed state when the symbol returns to "ok".
  useEffect(() => {
    setDismissed((prev) => {
      const next = new Set(prev);
      for (const s of prev) {
        if (!symbols[s] || symbols[s].status !== "doubt") {
          next.delete(s);
        }
      }
      return next;
    });
  }, [symbols]);

  const visible = doubtSymbols.filter((s) => !dismissed.has(s));
  if (visible.length === 0) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        background: "color-mix(in srgb, var(--put) 12%, var(--bg-raised))",
        borderBottom: "1px solid var(--put)",
        borderTop: "1px solid var(--put)",
        padding: "0",
      }}
    >
      {visible.map((s) => {
        const state = symbols[s];
        return (
          <div
            key={s}
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              padding: "10px 16px",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "flex-start", gap: 10, flex: 1 }}>
              {/* Warning icon */}
              <span
                aria-hidden="true"
                style={{
                  fontSize: 16,
                  color: "var(--put)",
                  flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                ⚠
              </span>

              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "var(--put)", marginBottom: 3 }}>
                  Data integrity check failed — {s}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-mid)", lineHeight: 1.5 }}>
                  {CONSECUTIVE_REJECT_THRESHOLD} or more consecutive price ticks failed validation
                  {state?.lastRejectReason
                    ? ` (${humanReason(state.lastRejectReason)})`
                    : ""}
                  . Displaying last known data.{" "}
                  <strong style={{ color: "var(--put)" }}>Trading is disabled</strong>{" "}
                  until the feed recovers.
                </div>
                {state && (
                  <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 4 }}>
                    {state.rejectCount} total rejection{state.rejectCount !== 1 ? "s" : ""}
                    {state.lastRejectAt
                      ? ` · last at ${new Date(state.lastRejectAt).toLocaleTimeString()}`
                      : ""}
                  </div>
                )}
              </div>
            </div>

            {/* Dismiss button */}
            <button
              onClick={() => setDismissed((prev) => new Set([...prev, s]))}
              aria-label={`Dismiss data integrity warning for ${s}`}
              style={{
                background: "none",
                border: "none",
                color: "var(--text-lo)",
                fontSize: 16,
                cursor: "pointer",
                lineHeight: 1,
                padding: "2px 4px",
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function humanReason(reason: string): string {
  const map: Record<string, string> = {
    non_finite_price: "non-finite price",
    non_positive_price: "non-positive price",
    price_below_floor: "price below minimum",
    price_above_ceiling: "price above maximum",
    non_finite_vol: "non-finite volatility",
    non_positive_vol: "non-positive volatility",
    vol_out_of_range: "volatility out of range",
    price_jump_too_large: "price jump too large",
    oracle_deviation_too_large: "deviates from oracle",
  };
  return map[reason] ?? reason;
}
