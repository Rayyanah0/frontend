"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  compareRoll,
  suggestRolls,
  type RollChain,
  type RollPosition,
  type RollSuggestion,
} from "../lib/suggestRolls";
import { collateralRequired } from "../lib/collateral";
import { fmtK, fmtN } from "../lib/pricing";
import { MultiLegPayoffDiagram } from "./MultiLegPayoffDiagram";
import type { PricedLeg } from "../lib/payoff";
import { ApiError } from "../lib/api/client";
import type { RollResult } from "../lib/api/positions";

interface Props {
  position: RollPosition & { id: string; currentPremiumTotal: number };
  spot: number;
  vol: number;
  balance: number;
  chain: RollChain;
  onClose: () => void;
  onRoll: (id: string, params: { newStrike: number; newExpiryDays: number }) => Promise<RollResult>;
}

type Step = 1 | 2 | 3;

export function RollWizard({ position, spot, vol, balance, chain, onClose, onRoll }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [selected, setSelected] = useState<RollSuggestion | null>(null);
  const [customStrike, setCustomStrike] = useState(position.strike);
  const [customExpiry, setCustomExpiry] = useState(
    chain.expiries.find(d => d > position.expiryDays) ?? position.expiryDays
  );
  const [useCustom, setUseCustom] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialFail, setPartialFail] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const suggestions = useMemo(() => suggestRolls(position, chain), [position, chain]);
  const laterExpiries = chain.expiries.filter(d => d > position.expiryDays).sort((a, b) => a - b);

  const target = useMemo(() => {
    if (useCustom) return { newStrike: customStrike, newExpiryDays: customExpiry };
    if (selected) return { newStrike: selected.newStrike, newExpiryDays: selected.newExpiryDays };
    return null;
  }, [useCustom, customStrike, customExpiry, selected]);

  const comparison = useMemo(() => {
    if (!target) return null;
    return compareRoll(
      position, spot, vol, target.newStrike, target.newExpiryDays,
      balance, position.currentPremiumTotal, collateralRequired
    );
  }, [target, position, spot, vol, balance]);

  const debitBlocked = comparison
    ? comparison.postRollBalance < 0 || (
      position.positionType === "short"
        ? balance + (comparison.oldCollateral - comparison.oldPremium) < comparison.newCollateral
        : balance + comparison.oldPremium < comparison.newPremium
    )
    : false;

  // Focus trap
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [onClose]);

  const oldLeg: PricedLeg = {
    side: position.optionType,
    action: position.positionType === "short" ? "sell" : "buy",
    strike: position.strike,
    contracts: position.contracts,
    expiryDays: position.expiryDays,
    greeks: { premium: position.entryPremium, delta: 0, gamma: 0, theta: 0, vega: 0, iv: 0 },
  };
  const newLeg: PricedLeg | null = target && comparison ? {
    side: position.optionType,
    action: position.positionType === "short" ? "sell" : "buy",
    strike: target.newStrike,
    contracts: position.contracts,
    expiryDays: target.newExpiryDays,
    greeks: { premium: comparison.newGreeks.premium, delta: 0, gamma: 0, theta: 0, vega: 0, iv: comparison.newGreeks.iv },
  } : null;

  const execute = async () => {
    if (!target || debitBlocked || submitting) return;
    setSubmitting(true);
    setError(null);
    setPartialFail(null);
    try {
      const result = await onRoll(position.id, {
        newStrike: target.newStrike,
        newExpiryDays: target.newExpiryDays,
      });
      // Backend returns { closed, opened }. Surface close-without-open.
      if (result.closed && !result.opened) {
        setPartialFail("Position was closed but the new leg failed to open. Funds were settled on the close.");
        setSubmitting(false);
        return;
      }
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Roll failed");
      setSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="roll-wizard-title"
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.65)", zIndex: 120,
        display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          width: 640, maxWidth: "100%", maxHeight: "90vh", overflowY: "auto",
          background: "var(--bg-elevated)", border: "1px solid var(--border-default)", padding: 20,
          outline: "none",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <div>
            <div id="roll-wizard-title" style={{ fontSize: 15, fontWeight: 700, color: "var(--text-hi)" }}>
              Roll {position.underlying} {position.optionType.toUpperCase()}
            </div>
            <div className="num" style={{ fontSize: 11, color: "var(--text-mid)" }}>
              K={fmtK(position.strike)} · {position.expiryDays}D · {position.positionType}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--text-lo)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        {/* Step indicators */}
        <div style={{ display: "flex", gap: 8, marginBottom: 16 }} role="tablist" aria-label="Roll steps">
          {([1, 2, 3] as Step[]).map(s => (
            <div key={s} style={{
              flex: 1, padding: "6px 0", textAlign: "center", fontSize: 11, fontWeight: 600,
              borderBottom: step === s ? "2px solid var(--brand)" : "2px solid var(--border-default)",
              color: step === s ? "var(--text-hi)" : "var(--text-lo)",
            }}>
              {s === 1 ? "1 · Target" : s === 2 ? "2 · Compare" : "3 · Confirm"}
            </div>
          ))}
        </div>

        {position.strategyId && (
          <div style={{ marginBottom: 12, padding: "8px 10px", border: "1px solid var(--atm)", background: "var(--atm-dim)", fontSize: 11, color: "var(--atm)" }}>
            Warning: this leg belongs to a strategy. Rolling it will break the strategy grouping.
          </div>
        )}

        {laterExpiries.length === 0 && (
          <div style={{ marginBottom: 12, fontSize: 12, color: "var(--put)" }}>
            No later expiry is available on the chain — cannot roll out.
          </div>
        )}

        {step === 1 && (
          <div>
            <div style={{ fontSize: 12, color: "var(--text-mid)", marginBottom: 10 }}>
              Choose a suggested roll, or pick a custom strike and expiry.
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {suggestions.map(s => (
                <button
                  key={s.id}
                  onClick={() => { setSelected(s); setUseCustom(false); }}
                  style={{
                    textAlign: "left", padding: "10px 12px", cursor: "pointer",
                    border: `1px solid ${!useCustom && selected?.id === s.id ? "var(--brand)" : "var(--border-default)"}`,
                    background: !useCustom && selected?.id === s.id ? "var(--bg-overlay)" : "var(--bg-raised)",
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{s.label}</div>
                  <div style={{ fontSize: 11, color: "var(--text-lo)", marginTop: 2 }}>{s.description}</div>
                </button>
              ))}
              <button
                onClick={() => setUseCustom(true)}
                style={{
                  textAlign: "left", padding: "10px 12px", cursor: "pointer",
                  border: `1px solid ${useCustom ? "var(--brand)" : "var(--border-default)"}`,
                  background: useCustom ? "var(--bg-overlay)" : "var(--bg-raised)",
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>Custom</div>
                <div style={{ display: "flex", gap: 12, marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: "var(--text-lo)" }}>
                    Strike
                    <select
                      value={customStrike}
                      onChange={e => { setCustomStrike(Number(e.target.value)); setUseCustom(true); }}
                      style={{ display: "block", marginTop: 4, padding: "4px 6px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)" }}
                    >
                      {chain.strikes.map(s => <option key={s} value={s}>{fmtK(s)}</option>)}
                    </select>
                  </label>
                  <label style={{ fontSize: 11, color: "var(--text-lo)" }}>
                    Expiry
                    <select
                      value={customExpiry}
                      onChange={e => { setCustomExpiry(Number(e.target.value)); setUseCustom(true); }}
                      style={{ display: "block", marginTop: 4, padding: "4px 6px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)" }}
                    >
                      {(laterExpiries.length ? laterExpiries : chain.expiries).map(d => (
                        <option key={d} value={d}>{d}D</option>
                      ))}
                    </select>
                  </label>
                </div>
              </button>
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button onClick={onClose} style={btnGhost}>Cancel</button>
              <button
                onClick={() => setStep(2)}
                disabled={!target || laterExpiries.length === 0 && !useCustom}
                style={{ ...btnPrimary, opacity: target ? 1 : 0.5 }}
              >Next · Compare</button>
            </div>
          </div>
        )}

        {step === 2 && comparison && target && (
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14 }}>
              <CompareCol title="Current" rows={[
                ["Premium", `$${fmtN(comparison.oldPremium, 2)}`],
                ["Δ", comparison.oldGreeks.delta.toFixed(3)],
                ["Γ", comparison.oldGreeks.gamma.toFixed(4)],
                ["Θ", comparison.oldGreeks.theta.toFixed(4)],
                ["V", comparison.oldGreeks.vega.toFixed(3)],
                ["Breakeven", fmtK(comparison.oldBreakeven)],
                ["Collateral", comparison.oldCollateral > 0 ? `$${fmtN(comparison.oldCollateral, 2)}` : "—"],
                ["DTE", `${comparison.oldDays}D`],
              ]} />
              <CompareCol title="New" rows={[
                ["Premium", `$${fmtN(comparison.newPremium, 2)}`],
                ["Δ", comparison.newGreeks.delta.toFixed(3)],
                ["Γ", comparison.newGreeks.gamma.toFixed(4)],
                ["Θ", comparison.newGreeks.theta.toFixed(4)],
                ["V", comparison.newGreeks.vega.toFixed(3)],
                ["Breakeven", fmtK(comparison.newBreakeven)],
                ["Collateral", comparison.newCollateral > 0 ? `$${fmtN(comparison.newCollateral, 2)}` : "—"],
                ["DTE", `${comparison.newDays}D`],
              ]} />
            </div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 6 }}>Payoff overlay · old vs new (expiry)</div>
            <MultiLegPayoffDiagram
              legs={newLeg ? [oldLeg, newLeg] : [oldLeg]}
              spot={spot}
              baseVol={vol}
              width={580}
              height={180}
              timeAware={false}
            />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16 }}>
              <button onClick={() => setStep(1)} style={btnGhost}>Back</button>
              <button onClick={() => setStep(3)} style={btnPrimary}>Next · Confirm</button>
            </div>
          </div>
        )}

        {step === 3 && comparison && target && (
          <div>
            <div style={{ background: "var(--bg-raised)", border: "1px solid var(--border-default)", padding: 14, marginBottom: 12 }}>
              {[
                ["Close → open", `${fmtK(position.strike)} ${position.expiryDays}D → ${fmtK(target.newStrike)} ${target.newExpiryDays}D`],
                [comparison.netCredit >= 0 ? "Net credit" : "Net debit", `$${fmtN(Math.abs(comparison.netCredit), 2)}`],
                ["Post-roll balance", `$${fmtN(comparison.postRollBalance, 2)}`],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                  <span style={{ color: "var(--text-lo)" }}>{k}</span>
                  <span className="num" style={{
                    color: k.startsWith("Net") ? (comparison.netCredit >= 0 ? "var(--call)" : "var(--put)") : "var(--text-hi)",
                    fontWeight: 600,
                  }}>{v}</span>
                </div>
              ))}
            </div>
            {debitBlocked && (
              <div style={{ marginBottom: 10, fontSize: 11, color: "var(--put)" }}>
                Insufficient balance for this debit roll.
              </div>
            )}
            {error && <div style={{ marginBottom: 10, fontSize: 11, color: "var(--put)" }}>{error}</div>}
            {partialFail && <div style={{ marginBottom: 10, fontSize: 11, color: "var(--put)" }}>{partialFail}</div>}
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
              <button onClick={() => setStep(2)} style={btnGhost} disabled={submitting}>Back</button>
              <button
                onClick={execute}
                disabled={debitBlocked || submitting}
                style={{ ...btnPrimary, opacity: debitBlocked || submitting ? 0.5 : 1 }}
              >{submitting ? "Rolling…" : "Confirm Roll"}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function CompareCol({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-hi)", marginBottom: 8 }}>{title}</div>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", fontSize: 11 }}>
          <span style={{ color: "var(--text-lo)" }}>{k}</span>
          <span className="num" style={{ color: "var(--text-hi)" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

const btnGhost: React.CSSProperties = {
  fontSize: 12, padding: "8px 14px", background: "none",
  border: "1px solid var(--border-default)", color: "var(--text-mid)", cursor: "pointer",
};
const btnPrimary: React.CSSProperties = {
  fontSize: 12, padding: "8px 14px", background: "var(--brand)",
  border: "none", color: "var(--bg)", fontWeight: 700, cursor: "pointer",
};
