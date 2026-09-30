import React from "react";
import { ExpandableCard } from "./ExpandableCard";
import { EXPIRIES, fmtN } from "../lib/pricing";

export interface MarkedPosition {
  id: string;
  underlying: string;
  position_type: string;
  option_type: string;
  strike: number;
  expiry_days: number;
  contracts: number;
  collateral: number;
  entry_premium: number;
  currentPremium: number;
  pnl: number;
  pnlPct: number;
  liveDelta: number;
}

export interface RollPreviewData {
  newPremium: number;
  netCashEffect: number;
}

export interface PositionMobileCardProps {
  p: MarkedPosition;
  sign: number;
  isRolling: boolean;
  notSignedIn: boolean;
  rolling: boolean;
  rollStrikeOffsetPct: number;
  setRollStrikeOffsetPct: React.Dispatch<React.SetStateAction<number>>;
  rollExpiry: typeof EXPIRIES[number];
  setRollExpiry: (e: typeof EXPIRIES[number]) => void;
  rollPreview: RollPreviewData | null;
  rollInsufficientFunds: boolean;
  onToggleRoll: () => void;
  onCancelRoll: () => void;
  onConfirmRoll: () => void;
  onClosePosition: () => void;
}
export function PositionMobileCard({
  p,
  sign,
  isRolling,
  notSignedIn,
  rolling,
  rollStrikeOffsetPct,
  setRollStrikeOffsetPct,
  rollExpiry,
  setRollExpiry,
  rollPreview,
  rollInsufficientFunds,
  onToggleRoll,
  onCancelRoll,
  onConfirmRoll,
  onClosePosition,
}: PositionMobileCardProps) {
  const strikeFmt =
    p.strike >= 1000
      ? p.strike.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.strike.toFixed(4);

  return (
    <ExpandableCard
      title={
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-hi)" }}>{p.underlying}</span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 6px",
              background: p.position_type === "short" ? "var(--put-dim)" : "var(--call-dim)",
              color: p.position_type === "short" ? "var(--put)" : "var(--call)",
              textTransform: "uppercase",
            }}
          >
            {p.position_type}
          </span>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "2px 6px",
              background: p.option_type === "call" ? "var(--call-dim)" : "var(--put-dim)",
              color: p.option_type === "call" ? "var(--call)" : "var(--put)",
              textTransform: "uppercase",
            }}
          >
            {p.option_type}
          </span>
        </div>
      }
      subtitle={
        <span className="num">
          K={strikeFmt} · {p.expiry_days}D · {p.contracts}×
        </span>
      }
      trailing={
        <div style={{ textAlign: "right" }}>
          <div className="num" style={{ fontSize: 13, fontWeight: 600, color: p.pnl >= 0 ? "var(--call)" : "var(--put)" }}>
            {p.pnl >= 0 ? "+" : "−"}${fmtN(Math.abs(p.pnl), 2)}
          </div>
          <div className="num" style={{ fontSize: 10, color: p.pnl >= 0 ? "var(--call)" : "var(--put)", opacity: 0.75 }}>
            {p.pnlPct >= 0 ? "+" : ""}{p.pnlPct.toFixed(1)}%
          </div>
        </div>
      }
      details={
        <>
          <div className="zn-kv">
            <span style={{ color: "var(--text-lo)" }}>Strike</span>
            <span className="num" style={{ color: "var(--text-hi)" }}>{strikeFmt}</span>
          </div>
          <div className="zn-kv">
            <span style={{ color: "var(--text-lo)" }}>Collateral</span>
            <span className="num" style={{ color: "var(--text-mid)" }}>{p.collateral > 0 ? `$${fmtN(p.collateral, 2)}` : "—"}</span>
          </div>
          <div className="zn-kv">
            <span style={{ color: "var(--text-lo)" }}>Entry Premium</span>
            <span className="num" style={{ color: "var(--text-mid)" }}>{p.position_type === "short" ? "+" : ""}${fmtN(p.entry_premium * p.contracts, 2)}</span>
          </div>
          <div className="zn-kv">
            <span style={{ color: "var(--text-lo)" }}>Current Value</span>
            <span className="num" style={{ color: "var(--text-hi)" }}>${fmtN(p.currentPremium, 2)}</span>
          </div>
          <div className="zn-kv">
            <span style={{ color: "var(--text-lo)" }}>Net Delta (Δ)</span>
            <span className="num" style={{ color: "var(--text-mid)" }}>{(sign * p.liveDelta * p.contracts).toFixed(3)}</span>
          </div>

          {isRolling && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                flexDirection: "column",
                gap: 10,
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-hi)" }}>Roll Position</div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Strike Offset</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => setRollStrikeOffsetPct((v) => v - 5)}
                    className="zn-tap"
                    style={{
                      background: "var(--bg-overlay)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-mid)",
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    −5%
                  </button>
                  <span className="num" style={{ fontSize: 12, color: "var(--brand)", minWidth: 44, textAlign: "center" }}>
                    {rollStrikeOffsetPct >= 0 ? `+${rollStrikeOffsetPct}%` : `${rollStrikeOffsetPct}%`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setRollStrikeOffsetPct((v) => v + 5)}
                    className="zn-tap"
                    style={{
                      background: "var(--bg-overlay)",
                      border: "1px solid var(--border-default)",
                      color: "var(--text-mid)",
                      padding: "4px 10px",
                      cursor: "pointer",
                    }}
                  >
                    +5%
                  </button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>New Expiry</div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  {EXPIRIES.map((e) => (
                    <button
                      key={e.label}
                      type="button"
                      onClick={() => setRollExpiry(e)}
                      className="zn-tap"
                      style={{
                        padding: "4px 8px",
                        border: "none",
                        cursor: "pointer",
                        fontSize: 11,
                        background: rollExpiry.label === e.label ? "var(--atm-dim)" : "var(--bg-overlay)",
                        color: rollExpiry.label === e.label ? "var(--atm)" : "var(--text-lo)",
                      }}
                    >
                      {e.label}
                    </button>
                  ))}
                </div>
              </div>
              {rollPreview && (
                <div style={{ display: "flex", gap: 16, padding: "6px 0" }}>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-lo)" }}>New Premium</div>
                    <span className="num" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>
                      ${fmtN(rollPreview.newPremium, 2)}
                    </span>
                  </div>
                  <div>
                    <div style={{ fontSize: 10, color: "var(--text-lo)" }}>
                      {rollPreview.netCashEffect >= 0 ? "Net Credit" : "Net Cost"}
                    </div>
                    <span
                      className="num"
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: rollPreview.netCashEffect >= 0 ? "var(--call)" : "var(--put)",
                      }}
                    >
                      ${fmtN(Math.abs(rollPreview.netCashEffect), 2)}
                    </span>
                  </div>
                </div>
              )}
              {rollInsufficientFunds && (
                <span style={{ fontSize: 11, color: "var(--put)" }}>Insufficient balance for the new leg</span>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={onCancelRoll}
                  className="zn-tap"
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: "var(--text-lo)",
                    background: "none",
                    border: "1px solid var(--border-default)",
                    padding: "8px",
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onConfirmRoll}
                  className="zn-tap"
                  disabled={rollInsufficientFunds || rolling}
                  style={{
                    flex: 1,
                    fontSize: 12,
                    color: "var(--bg)",
                    background: "var(--brand)",
                    border: "none",
                    padding: "8px",
                    cursor: rollInsufficientFunds || rolling ? "default" : "pointer",
                    opacity: rollInsufficientFunds || rolling ? 0.5 : 1,
                  }}
                >
                  {rolling ? "Rolling…" : "Confirm Roll"}
                </button>
              </div>
            </div>
          )}

          <div className="zn-actions">
            <button
              type="button"
              onClick={onToggleRoll}
              disabled={notSignedIn}
              style={{
                flex: 1,
                border: "1px solid var(--border-default)",
                background: "var(--bg-overlay)",
                color: isRolling ? "var(--brand)" : "var(--text-hi)",
                opacity: notSignedIn ? 0.5 : 1,
                cursor: notSignedIn ? "default" : "pointer",
              }}
            >
              {isRolling ? "Close Roll" : "Roll"}
            </button>
            <button
              type="button"
              onClick={onClosePosition}
              disabled={notSignedIn}
              style={{
                flex: 1,
                border: "1px solid var(--border-default)",
                background: "var(--bg-overlay)",
                color: "var(--text-hi)",
                opacity: notSignedIn ? 0.5 : 1,
                cursor: notSignedIn ? "default" : "pointer",
              }}
            >
              {p.position_type === "short" ? "Buy to close" : "Sell to close"}
            </button>
          </div>
        </>
      }
    />
  );
}
