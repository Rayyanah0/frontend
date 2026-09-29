"use client";

import { useEffect, useMemo, useReducer, useState } from "react";
import { STRATEGY_TEMPLATES } from "../lib/strategies";
import {
  MAX_LEGS,
  builderReducer,
  deleteSavedStrategy,
  emptyBuilder,
  exportStrategiesJson,
  importStrategiesJson,
  listSavedStrategies,
  saveStrategy,
  stepStrike,
  validateBuilder,
  type BuilderLeg,
  type SavedStrategy,
} from "../lib/strategyBuilder";
import { bs, smileVol, fmtK, fmtN } from "../lib/pricing";
import { netPremium, type PricedLeg } from "../lib/payoff";
import { riskProfile } from "../lib/risk";
import { collateralRequired } from "../lib/collateral";
import { MultiLegPayoffDiagram } from "./MultiLegPayoffDiagram";

interface Props {
  spot: number;
  vol: number;
  expiryDays: number;
  expiryLabel: string;
  strikes: number[];
  balance: number;
  notSignedIn: boolean;
  submitting: boolean;
  onExecute: (legs: PricedLeg[]) => void;
}

function priceLegs(
  legs: BuilderLeg[],
  spot: number,
  vol: number,
  t: number
): PricedLeg[] {
  return legs.map(leg => {
    const iv = smileVol(vol, leg.strike / Math.max(spot, 1e-9));
    const greeks = bs(spot, leg.strike, iv, t, leg.side === "call");
    return {
      side: leg.side,
      action: leg.action,
      strike: leg.strike,
      contracts: leg.quantity,
      expiryDays: leg.expiryDays,
      iv,
      greeks,
    };
  });
}

export function StrategyBuilder({
  spot, vol, expiryDays, expiryLabel, strikes, balance, notSignedIn, submitting, onExecute,
}: Props) {
  const [state, dispatch] = useReducer(builderReducer, emptyBuilder());
  const [saved, setSaved] = useState<SavedStrategy[]>([]);
  const [qtyDefault, setQtyDefault] = useState(1);

  useEffect(() => { setSaved(listSavedStrategies()); }, []);

  const t = expiryDays / 365;
  const priced = useMemo(() => priceLegs(state.legs, spot, vol, t), [state.legs, spot, vol, t]);
  const premium = useMemo(() => netPremium(priced), [priced]);
  const profile = useMemo(() => riskProfile(priced, spot), [priced, spot]);
  const collateral = useMemo(
    () => priced.reduce((s, l) => l.action === "sell" ? s + collateralRequired(l.side, l.contracts, l.strike, spot) : s, 0),
    [priced, spot]
  );
  const required = collateral + Math.max(0, premium);
  const errors = validateBuilder(state, strikes);
  const insufficient = priced.length > 0 && balance < required;
  const nakedShortCall = priced.some(l => l.action === "sell" && l.side === "call")
    && profile.maxLossUnlimited;

  const canExecute = errors.length === 0 && !insufficient && !notSignedIn && !submitting && priced.length > 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
      {/* Templates + saved */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-lo)" }}>Templates</div>
        {STRATEGY_TEMPLATES.map(t => (
          <button
            key={t.id}
            onClick={() => dispatch({
              type: "applyTemplate",
              template: t,
              spot,
              expiryDays,
              quantity: qtyDefault,
              strikes,
            })}
            style={{
              textAlign: "left", padding: "10px 12px", border: "1px solid var(--border-default)",
              background: state.templateId === t.id ? "var(--bg-overlay)" : "var(--bg-raised)",
              cursor: "pointer",
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>{t.name}</div>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginTop: 2 }}>{t.legs.length} legs</div>
          </button>
        ))}

        <div style={{ fontSize: 10, textTransform: "uppercase", color: "var(--text-lo)", marginTop: 8 }}>Saved</div>
        {saved.length === 0 && <div style={{ fontSize: 11, color: "var(--text-lo)" }}>No saved strategies</div>}
        {saved.map(s => (
          <div key={s.name} style={{ display: "flex", gap: 4 }}>
            <button
              onClick={() => dispatch({
                type: "load",
                state: {
                  name: s.name,
                  templateId: null,
                  legs: s.legs.map((l, i) => ({ ...l, id: `saved-${i}` })),
                },
              })}
              style={{
                flex: 1, textAlign: "left", padding: "8px 10px", border: "1px solid var(--border-default)",
                background: "var(--bg-raised)", cursor: "pointer", fontSize: 11, color: "var(--text-hi)",
              }}
            >{s.name}</button>
            <button
              onClick={() => setSaved(deleteSavedStrategy(s.name))}
              style={{ padding: "0 8px", border: "1px solid var(--border-default)", background: "none", color: "var(--text-lo)", cursor: "pointer" }}
              aria-label={`Delete ${s.name}`}
            >×</button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
          <button
            onClick={() => {
              const blob = new Blob([exportStrategiesJson(saved)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = "zenith-strategies.json";
              a.click();
            }}
            style={{ flex: 1, fontSize: 10, padding: "6px", border: "1px solid var(--border-default)", background: "none", color: "var(--text-mid)", cursor: "pointer" }}
          >Export JSON</button>
          <label style={{ flex: 1, fontSize: 10, padding: "6px", border: "1px solid var(--border-default)", color: "var(--text-mid)", cursor: "pointer", textAlign: "center" }}>
            Import
            <input
              type="file" accept="application/json" hidden
              onChange={async e => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  setSaved(importStrategiesJson(await file.text()));
                } catch { /* ignore bad JSON */ }
              }}
            />
          </label>
        </div>
      </div>

      {/* Editor */}
      <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <input
            value={state.name}
            onChange={e => dispatch({ type: "setName", name: e.target.value })}
            style={{
              fontSize: 14, fontWeight: 700, color: "var(--text-hi)", background: "transparent",
              border: "none", borderBottom: "1px solid var(--border-default)", outline: "none", width: 220,
            }}
          />
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <label style={{ fontSize: 10, color: "var(--text-lo)" }}>Default qty</label>
            <input
              type="number" min={0.01} step={0.01} value={qtyDefault}
              onChange={e => setQtyDefault(Math.max(0.01, parseFloat(e.target.value) || 1))}
              style={{ width: 56, padding: "4px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11 }}
            />
            <button
              onClick={() => dispatch({ type: "addLeg", spot, expiryDays, strikes })}
              disabled={state.legs.length >= MAX_LEGS}
              style={{
                fontSize: 11, padding: "5px 10px", border: "1px solid var(--brand)",
                background: "none", color: "var(--brand)", cursor: "pointer",
                opacity: state.legs.length >= MAX_LEGS ? 0.4 : 1,
              }}
            >+ Leg</button>
            <button
              onClick={() => setSaved(saveStrategy(state.name || "Custom", state.legs))}
              disabled={state.legs.length === 0}
              style={{ fontSize: 11, padding: "5px 10px", border: "1px solid var(--border-default)", background: "none", color: "var(--text-mid)", cursor: "pointer" }}
            >Save</button>
          </div>
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
          <thead>
            <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
              {["Side", "Action", "Strike", "Qty", "Expiry", ""].map(h => (
                <th key={h} style={{ padding: "4px 6px", fontSize: 10, color: "var(--text-lo)", textAlign: "left", fontWeight: 500 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.legs.map(leg => (
              <tr key={leg.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                <td style={{ padding: "4px 6px" }}>
                  <select
                    value={leg.side}
                    onChange={e => dispatch({ type: "updateLeg", id: leg.id, patch: { side: e.target.value as "call" | "put" } })}
                    style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11, padding: "4px" }}
                  >
                    <option value="call">Call</option>
                    <option value="put">Put</option>
                  </select>
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <select
                    value={leg.action}
                    onChange={e => dispatch({ type: "updateLeg", id: leg.id, patch: { action: e.target.value as "buy" | "sell" } })}
                    style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11, padding: "4px" }}
                  >
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </select>
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <button
                      aria-label="Decrease strike"
                      onClick={() => dispatch({ type: "setStrike", id: leg.id, strike: stepStrike(leg.strike, strikes, -1) })}
                      style={{ padding: "2px 6px", border: "1px solid var(--border-default)", background: "none", color: "var(--text-mid)", cursor: "pointer" }}
                    >←</button>
                    <select
                      value={leg.strike}
                      onChange={e => dispatch({ type: "setStrike", id: leg.id, strike: Number(e.target.value) })}
                      style={{ background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11, padding: "4px", fontFamily: "var(--font-mono)" }}
                    >
                      {strikes.map(s => <option key={s} value={s}>{fmtK(s)}</option>)}
                    </select>
                    <button
                      aria-label="Increase strike"
                      onClick={() => dispatch({ type: "setStrike", id: leg.id, strike: stepStrike(leg.strike, strikes, 1) })}
                      style={{ padding: "2px 6px", border: "1px solid var(--border-default)", background: "none", color: "var(--text-mid)", cursor: "pointer" }}
                    >→</button>
                  </div>
                </td>
                <td style={{ padding: "4px 6px" }}>
                  <input
                    type="number" min={0.01} step={0.01} value={leg.quantity}
                    onChange={e => dispatch({
                      type: "updateLeg", id: leg.id,
                      patch: { quantity: Math.max(0.01, parseFloat(e.target.value) || 0.01) },
                    })}
                    style={{ width: 64, padding: "4px", background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11, fontFamily: "var(--font-mono)" }}
                  />
                </td>
                <td style={{ padding: "4px 6px", fontSize: 11, color: "var(--text-mid)" }}>{expiryLabel}</td>
                <td style={{ padding: "4px 6px" }}>
                  <button
                    onClick={() => dispatch({ type: "removeLeg", id: leg.id })}
                    style={{ fontSize: 11, border: "none", background: "none", color: "var(--put)", cursor: "pointer" }}
                  >Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {nakedShortCall && (
          <div style={{ marginBottom: 10, padding: "8px 10px", border: "1px solid var(--put)", background: "var(--put-dim)", fontSize: 11, color: "var(--put)", fontWeight: 600 }}>
            Naked short call — max loss is unlimited
          </div>
        )}

        {priced.length > 0 && (
          <>
            <div style={{ display: "flex", gap: 20, marginBottom: 12, flexWrap: "wrap" }}>
              <Stat label={premium >= 0 ? "Net Debit" : "Net Credit"} value={`$${fmtN(Math.abs(premium), 2)}`} color={premium >= 0 ? "var(--put)" : "var(--call)"} />
              <Stat label="Collateral" value={collateral > 0 ? `$${fmtN(collateral, 2)}` : "—"} color="var(--atm)" />
              <Stat
                label="Max Profit"
                value={profile.maxProfitUnlimited ? "Unlimited" : `+$${fmtN(profile.maxProfit, 2)}`}
                color="var(--call)"
              />
              <Stat
                label="Max Loss"
                value={profile.maxLossUnlimited ? "Unlimited" : `−$${fmtN(Math.abs(profile.maxLoss), 2)}`}
                color="var(--put)"
              />
              <Stat
                label="Breakevens"
                value={profile.breakevens.length ? profile.breakevens.map(b => fmtK(b)).join(" / ") : "—"}
                color="var(--text-hi)"
              />
            </div>

            <MultiLegPayoffDiagram
              legs={priced}
              spot={spot}
              baseVol={vol}
              width={520}
              height={220}
              strikes={strikes}
              onStrikeDrag={(legIndex, newStrike) => {
                const leg = state.legs[legIndex];
                if (leg) dispatch({ type: "setStrike", id: leg.id, strike: newStrike });
              }}
            />
          </>
        )}

        {errors.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--put)" }}>{errors[0]}</div>
        )}
        {insufficient && (
          <div style={{ marginTop: 8, fontSize: 11, color: "var(--put)" }}>
            Collateral/debit ${fmtN(required, 2)} exceeds balance ${fmtN(balance, 2)}
          </div>
        )}

        <button
          onClick={() => onExecute(priced)}
          disabled={!canExecute}
          style={{
            marginTop: 12, padding: "10px 20px", background: "var(--brand)", color: "var(--bg)",
            border: "none", fontSize: 13, fontWeight: 700,
            cursor: canExecute ? "pointer" : "default", opacity: canExecute ? 1 : 0.5,
          }}
        >
          {submitting ? "Submitting…" : `Execute ${state.name} (${priced.length} legs)`}
        </button>
        {notSignedIn && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--put)" }}>Connect your wallet to trade.</div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)" }}>{label}</div>
      <div className="num" style={{ fontSize: 13, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}
