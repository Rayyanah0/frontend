"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  attribute,
  daysBetween,
  loadBaseline,
  saveBaseline,
  type PositionSnapshot,
  type StoredBaseline,
} from "../lib/attribution";
import { fmtN } from "../lib/pricing";

interface LiveMark {
  id: string;
  underlying: string;
  option_type: "call" | "put";
  position_type: "long" | "short";
  strike: number;
  contracts: number;
  currentPremium: number;
  spot: number;
  liveDelta: number;
  liveGamma: number;
  liveTheta: number;
  liveVega: number;
  iv: number;
}

function toSnapshot(m: LiveMark): PositionSnapshot {
  return {
    id: m.id,
    underlying: m.underlying,
    option_type: m.option_type,
    position_type: m.position_type,
    strike: m.strike,
    contracts: m.contracts,
    premium: m.currentPremium / m.contracts,
    spot: m.spot,
    iv: m.iv,
    delta: m.liveDelta,
    gamma: m.liveGamma,
    theta: m.liveTheta,
    vega: m.liveVega,
  };
}

function fmtSigned(n: number) {
  const a = Math.abs(n);
  return `${n >= 0 ? "+" : "−"}$${fmtN(a, 2)}`;
}

export function AttributionPanel({ marks }: { marks: LiveMark[] }) {
  const [baseline, setBaseline] = useState<StoredBaseline | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setBaseline(loadBaseline());
  }, []);

  // Refresh attribution every few seconds so intraday moves show up.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 3000);
    return () => clearInterval(id);
  }, []);

  const capture = useCallback(() => {
    const snap = saveBaseline(marks.map(toSnapshot));
    setBaseline(snap);
  }, [marks]);

  const result = useMemo(() => {
    void tick;
    if (!baseline) return null;
    const after = marks.map(toSnapshot);
    const dt = daysBetween(baseline.capturedAt, new Date().toISOString());
    return attribute(baseline.positions, after, dt);
  }, [baseline, marks, tick]);

  const waterfallSvg = useMemo(() => {
    if (!result) return null;
    const steps = result.waterfall.filter(s => s.label !== "Current");
    const values = steps.map(s => s.cumulative);
    const lo = Math.min(0, ...values);
    const hi = Math.max(0, ...values);
    const range = Math.max(hi - lo, 1e-6);
    const W = 520;
    const H = 120;
    const pad = { t: 12, r: 12, b: 28, l: 12 };
    const innerW = W - pad.l - pad.r;
    const innerH = H - pad.t - pad.b;
    const barW = innerW / steps.length - 8;
    const zeroY = pad.t + ((hi - 0) / range) * innerH;

    return (
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} aria-label="P&L attribution waterfall">
        <line x1={pad.l} y1={zeroY} x2={W - pad.r} y2={zeroY} stroke="var(--border-default)" strokeWidth={1} />
        {steps.map((s, i) => {
          const x = pad.l + i * (innerW / steps.length) + 4;
          const y = pad.t + ((hi - s.cumulative) / range) * innerH;
          const prevCum = i === 0 ? 0 : steps[i - 1].cumulative;
          const top = Math.min(y, pad.t + ((hi - prevCum) / range) * innerH);
          const bot = Math.max(y, pad.t + ((hi - prevCum) / range) * innerH);
          const h = Math.max(2, bot - top);
          const color = s.label === "Baseline" ? "var(--text-lo)" : s.value >= 0 ? "var(--call)" : "var(--put)";
          return (
            <g key={s.label}>
              <rect x={x} y={top} width={barW} height={h} fill={color} opacity={0.85} />
              <text x={x + barW / 2} y={H - 8} textAnchor="middle" fill="var(--text-lo)" fontSize={10}>
                {s.label}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }, [result]);

  return (
    <div style={{ marginBottom: 32, border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "16px 18px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--text-lo)", marginBottom: 4 }}>
            P&L Attribution
          </div>
          <div style={{ fontSize: 13, color: "var(--text-mid)" }}>
            Taylor decomposition of mark-to-market moves into Δ, Γ, Θ, V, and residual.
            {baseline && (
              <span className="num" style={{ marginLeft: 8, color: "var(--atm)" }}>
                Baseline {new Date(baseline.capturedAt).toLocaleString()}
              </span>
            )}
          </div>
        </div>
        <button
          onClick={capture}
          aria-label="Capture attribution baseline snapshot"
          style={{
            fontSize: 11, fontWeight: 600, color: "var(--bg)", background: "var(--brand)",
            border: "none", padding: "6px 12px", cursor: "pointer", flexShrink: 0,
          }}
        >
          {baseline ? "Reset baseline" : "Capture baseline"}
        </button>
      </div>

      {!baseline || !result ? (
        <div style={{ fontSize: 12, color: "var(--text-lo)", padding: "12px 0" }}>
          Capture a baseline (session start or any chosen time) to attribute subsequent P&L.
          Snapshots persist locally in this browser.
        </div>
      ) : (
        <>
          {result.modelError && (
            <div
              role="status"
              style={{
                marginBottom: 12, padding: "8px 12px", border: "1px solid var(--atm)",
                background: "var(--atm-dim)", fontSize: 12, color: "var(--atm)",
              }}
            >
              Residual is &gt;10% of total P&L — model error / large move. Higher-order terms or gap risk dominate.
            </div>
          )}

          <div style={{ display: "flex", gap: 0, marginBottom: 16, border: "1px solid var(--border-subtle)" }}>
            {[
              { label: "Total", value: result.totalPnl },
              { label: "Delta", value: result.delta },
              { label: "Gamma", value: result.gamma },
              { label: "Theta", value: result.theta },
              { label: "Vega", value: result.vega },
              { label: "Residual", value: result.residual },
            ].map((s, i) => (
              <div key={s.label} style={{ flex: 1, padding: "10px 12px", borderRight: i < 5 ? "1px solid var(--border-subtle)" : "none" }}>
                <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 4 }}>{s.label}</div>
                <div className="num" style={{ fontSize: 14, fontWeight: 600, color: s.value >= 0 ? "var(--call)" : "var(--put)" }}>
                  {fmtSigned(s.value)}
                </div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: 16 }}>{waterfallSvg}</div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border-default)" }}>
                  {["Position", "Total", "Δ", "Γ", "Θ", "V", "Residual", ""].map(h => (
                    <th key={h} style={{ padding: "6px 8px", fontSize: 10, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-lo)", textAlign: "right", background: "var(--bg-overlay)" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.byPosition.map(p => (
                  <tr key={p.id} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                    <td style={{ padding: "8px", fontSize: 11, color: "var(--text-hi)", textAlign: "left" }}>
                      {p.underlying}
                      {p.openedSinceBaseline && <span style={{ marginLeft: 6, color: "var(--atm)", fontSize: 10 }}>opened</span>}
                      {p.closedSinceBaseline && <span style={{ marginLeft: 6, color: "var(--text-lo)", fontSize: 10 }}>closed</span>}
                    </td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: p.totalPnl >= 0 ? "var(--call)" : "var(--put)" }}>{fmtSigned(p.totalPnl)}</td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtSigned(p.delta)}</td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtSigned(p.gamma)}</td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtSigned(p.theta)}</td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtSigned(p.vega)}</td>
                    <td className="num" style={{ padding: "8px", fontSize: 11, textAlign: "right", color: "var(--text-mid)" }}>{fmtSigned(p.residual)}</td>
                    <td style={{ padding: "8px", fontSize: 10, textAlign: "right", color: "var(--atm)" }}>
                      {p.modelError ? "model error" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
