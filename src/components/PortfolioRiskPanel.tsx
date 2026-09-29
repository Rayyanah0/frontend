"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import type { Position } from "../lib/api/types";
import {
  groupPositionsByUnderlying,
  positionsToLegs,
  riskProfile,
  stressTestPortfolio,
  scenarioGrid,
  defaultScenarioAxis,
  type ScenarioCell,
  type ScenarioMode,
} from "../lib/risk";
import { netPremium } from "../lib/payoff";
import { fmtN, fmtSpot } from "../lib/pricing";
import { MultiLegPayoffDiagram } from "./MultiLegPayoffDiagram";
import { toCsv, downloadCsv } from "../lib/csv";
import { buildDivergingScale } from "../lib/heatScale";

interface Props {
  positions: Position[];
  spots: Record<string, number>;
  vols: Record<string, number>;
}

const pnlColor = (v: number) => (v >= 0 ? "var(--call)" : "var(--put)");
const fmtPnl = (v: number) => `${v >= 0 ? "+" : "−"}$${fmtN(Math.abs(v), 2)}`;

type RiskMode = "marktomodel" | "expiry";

export function PortfolioRiskPanel({ positions, spots, vols }: Props) {
  const groups = useMemo(() => groupPositionsByUnderlying(positions), [positions]);
  const underlyings = useMemo(() => Array.from(groups.keys()).sort(), [groups]);
  const [selected, setSelected] = useState(underlyings[0] ?? "");
  const activeUnderlying = underlyings.includes(selected) ? selected : underlyings[0];

  const [riskMode, setRiskMode] = useState<RiskMode>("marktomodel");
  const [scenarioMode, setScenarioMode] = useState<ScenarioMode>("correlated");
  const [daysForward, setDaysForward] = useState(1);
  const [spotMin, setSpotMin] = useState(-30);
  const [spotMax, setSpotMax] = useState(30);
  const [ivMin, setIvMin] = useState(-50);
  const [ivMax, setIvMax] = useState(100);
  const [drill, setDrill] = useState<ScenarioCell | null>(null);
  const [workerMs, setWorkerMs] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  const legs = useMemo(
    () => (activeUnderlying ? positionsToLegs(groups.get(activeUnderlying) ?? []) : []),
    [groups, activeUnderlying]
  );
  const spot = spots[activeUnderlying] ?? 0;
  const profile = useMemo(() => riskProfile(legs, spot), [legs, spot]);
  const premium = useMemo(() => netPremium(legs), [legs]);
  const stress = useMemo(() => stressTestPortfolio(positions, spots), [positions, spots]);

  const axis = useMemo(() => {
    const base = defaultScenarioAxis(daysForward);
    const n = 15;
    const spotShocks: number[] = [];
    const ivShocks: number[] = [];
    for (let i = 0; i < n; i++) {
      spotShocks.push((spotMin + ((spotMax - spotMin) * i) / (n - 1)) / 100);
      ivShocks.push((ivMin + ((ivMax - ivMin) * i) / (n - 1)) / 100);
    }
    return { ...base, spotShocks, ivShocks, daysForward };
  }, [daysForward, spotMin, spotMax, ivMin, ivMax]);

  const [grid, setGrid] = useState(() =>
    scenarioGrid(positions, spots, vols, axis, scenarioMode)
  );

  useEffect(() => {
    let cancelled = false;
    // Prefer quant worker when available; fall back to main-thread.
    try {
      if (!workerRef.current) {
        workerRef.current = new Worker(new URL("../lib/workers/quantWorker.ts", import.meta.url));
      }
      const w = workerRef.current;
      const onMsg = (ev: MessageEvent) => {
        if (cancelled) return;
        if (ev.data?.type === "scenarioGridResult") {
          setGrid(ev.data.result);
          setWorkerMs(ev.data.result.elapsedMs);
        }
      };
      w.addEventListener("message", onMsg);
      w.postMessage({
        type: "scenarioGrid",
        positions,
        spots,
        vols,
        axis,
        mode: scenarioMode,
      });
      return () => {
        cancelled = true;
        w.removeEventListener("message", onMsg);
      };
    } catch {
      const result = scenarioGrid(positions, spots, vols, axis, scenarioMode);
      setGrid(result);
      setWorkerMs(result.elapsedMs);
    }
  }, [positions, spots, vols, axis, scenarioMode]);

  useEffect(() => () => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  const heat = useMemo(
    () => buildDivergingScale(grid.cells.map(c => c.totalPnl)),
    [grid]
  );

  const exportCsv = () => {
    const csv = toCsv(grid.cells, [
      { header: "spot_shock", value: r => r.spotShock },
      { header: "iv_shock", value: r => r.ivShock },
      { header: "total_pnl", value: r => r.totalPnl },
      ...underlyings.map(u => ({
        header: `pnl_${u}`,
        value: (r: ScenarioCell) => r.byUnderlying[u] ?? 0,
      })),
    ]);
    downloadCsv(`scenario-grid-${Date.now()}.csv`, csv);
  };

  if (underlyings.length === 0) return null;

  return (
    <div style={{ marginBottom: 24, border: "1px solid var(--border-default)", background: "var(--bg-raised)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--text-hi)" }}>Portfolio Risk</div>
        <div style={{ display: "flex", gap: 2 }}>
          {underlyings.map(u => (
            <button key={u} onClick={() => setSelected(u)} className="zn-tap" style={{
              padding: "3px 10px", border: "none", cursor: "pointer", fontSize: 11,
              background: activeUnderlying === u ? "var(--atm-dim)" : "transparent",
              color: activeUnderlying === u ? "var(--atm)" : "var(--text-lo)",
            }}>{u}</button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, padding: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
            Mark-to-model payoff · {activeUnderlying} · today / T+n / expiry
          </div>
          <MultiLegPayoffDiagram legs={legs} spot={spot} width={420} height={200} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 160, paddingTop: 20 }}>
          {[
            { label: "Net Premium", value: `${premium >= 0 ? "−" : "+"}$${fmtN(Math.abs(premium), 2)}`, color: "var(--text-hi)" },
            {
              label: "Max Profit",
              value: profile.maxProfitUnlimited ? "Unlimited" : `+$${fmtN(profile.maxProfit, 2)}`,
              color: "var(--call)",
            },
            {
              label: "Max Loss",
              value: profile.maxLossUnlimited ? "Unlimited" : `−$${fmtN(Math.abs(profile.maxLoss), 2)}`,
              color: "var(--put)",
            },
            {
              label: profile.breakevens.length === 1 ? "Breakeven" : "Breakevens",
              value: profile.breakevens.length === 0 ? "—" : profile.breakevens.map(b => fmtSpot(b)).join(" / "),
              color: "var(--text-hi)",
            },
          ].map(s => (
            <div key={s.label}>
              <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-lo)", marginBottom: 2 }}>{s.label}</div>
              <div className="num" style={{ fontSize: 13, fontWeight: 600, color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ borderTop: "1px solid var(--border-default)", padding: "12px 16px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Scenario
          </span>
          {([
            ["marktomodel", "Mark-to-model"],
            ["expiry", "Expiry stress"],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setRiskMode(id)}
              style={{
                padding: "3px 10px", border: "1px solid var(--border-default)", cursor: "pointer", fontSize: 11,
                background: riskMode === id ? "var(--atm-dim)" : "transparent",
                color: riskMode === id ? "var(--atm)" : "var(--text-lo)",
              }}
            >
              {label}
            </button>
          ))}
          {riskMode === "marktomodel" && (
            <>
              <button
                type="button"
                onClick={() => setScenarioMode(m => (m === "correlated" ? "independent" : "correlated"))}
                style={{
                  padding: "3px 10px", border: "1px solid var(--border-default)", cursor: "pointer", fontSize: 11,
                  background: "var(--bg-elevated)", color: "var(--text-mid)",
                }}
              >
                {scenarioMode === "correlated" ? "Correlated" : "Independent"}
              </button>
              <label style={{ fontSize: 10, color: "var(--text-lo)", display: "flex", alignItems: "center", gap: 4 }}>
                Days fwd
                <input
                  type="number"
                  min={0}
                  max={180}
                  value={daysForward}
                  onChange={e => setDaysForward(Math.max(0, Number(e.target.value) || 0))}
                  style={{ width: 48, background: "var(--bg-overlay)", border: "1px solid var(--border-default)", color: "var(--text-hi)", fontSize: 11, padding: "2px 4px" }}
                />
              </label>
              <label style={{ fontSize: 10, color: "var(--text-lo)" }}>
                Spot% [{spotMin},{spotMax}]
                <input type="range" min={-50} max={0} value={spotMin} onChange={e => setSpotMin(Number(e.target.value))} />
                <input type="range" min={0} max={50} value={spotMax} onChange={e => setSpotMax(Number(e.target.value))} />
              </label>
              <label style={{ fontSize: 10, color: "var(--text-lo)" }}>
                IV% [{ivMin},{ivMax}]
                <input type="range" min={-80} max={0} value={ivMin} onChange={e => setIvMin(Number(e.target.value))} />
                <input type="range" min={0} max={150} value={ivMax} onChange={e => setIvMax(Number(e.target.value))} />
              </label>
              <button
                type="button"
                onClick={exportCsv}
                style={{
                  marginLeft: "auto", padding: "3px 10px", border: "1px solid var(--border-default)",
                  cursor: "pointer", fontSize: 11, background: "var(--bg-elevated)", color: "var(--text-mid)",
                }}
              >
                Export CSV
              </button>
              {workerMs != null && (
                <span className="num" style={{ fontSize: 9, color: "var(--text-lo)" }}>
                  {workerMs.toFixed(1)} ms · {grid.spotShocks.length}×{grid.ivShocks.length}
                </span>
              )}
            </>
          )}
        </div>

        {riskMode === "expiry" ? (
          <>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
              Stress test · account-wide P&amp;L if every underlying moved this much and every position ran to expiry
            </div>
            <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
              {stress.map(r => (
                <div key={r.shock} style={{
                  flex: "1 0 90px", padding: "8px 10px", textAlign: "center",
                  borderLeft: "1px solid var(--border-subtle)",
                  background: r.shock === 0 ? "var(--bg-elevated)" : "transparent",
                }}>
                  <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 4 }}>
                    {r.shock === 0 ? "Now" : `${r.shock > 0 ? "+" : ""}${(r.shock * 100).toFixed(0)}%`}
                  </div>
                  <div className="num" style={{ fontSize: 12, fontWeight: 600, color: pnlColor(r.totalPnl) }}>
                    {fmtPnl(r.totalPnl)}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <div style={{ fontSize: 10, color: "var(--text-lo)", marginBottom: 8 }}>
              Spot × IV mark-to-model grid · click a cell to drill down · worst case highlighted
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ borderCollapse: "collapse" }} role="grid" aria-label="Scenario P and L matrix">
                <thead>
                  <tr>
                    <th style={{ fontSize: 8, color: "var(--text-lo)", padding: 2 }}>IV \ Spot</th>
                    {grid.spotShocks.map(s => (
                      <th key={s} className="num" style={{ fontSize: 8, color: "var(--text-lo)", padding: "2px 4px" }}>
                        {(s * 100).toFixed(0)}%
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.ivShocks.map((iv, ri) => (
                    <tr key={iv}>
                      <th className="num" style={{ fontSize: 8, color: "var(--text-lo)", padding: "2px 4px", textAlign: "right" }}>
                        {(iv * 100).toFixed(0)}%
                      </th>
                      {grid.spotShocks.map((sp, ci) => {
                        const cellIdx = grid.cells.findIndex(c => c.spotShock === sp && c.ivShock === iv);
                        const cell = grid.cells[cellIdx];
                        if (!cell) return <td key={ci} />;
                        const isWorst = cellIdx === grid.worstIndex;
                        return (
                          <td key={ci}>
                            <button
                              type="button"
                              onClick={() => setDrill(cell)}
                              className="num"
                              style={{
                                display: "block",
                                width: "100%",
                                minWidth: 44,
                                padding: "4px 2px",
                                border: isWorst ? "1px solid var(--put)" : "1px solid transparent",
                                cursor: "pointer",
                                fontSize: 9,
                                fontWeight: isWorst ? 700 : 500,
                                background: heat.bg(cell.totalPnl),
                                color: heat.fg(cell.totalPnl),
                              }}
                              title={`Spot ${(sp * 100).toFixed(0)}% · IV ${(iv * 100).toFixed(0)}% · ${fmtPnl(cell.totalPnl)}`}
                            >
                              {fmtPnl(cell.totalPnl)}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {drill && (
              <div style={{ marginTop: 12, padding: 10, border: "1px solid var(--border-default)", background: "var(--bg-elevated)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 11, color: "var(--text-hi)" }}>
                    Drill · spot {(drill.spotShock * 100).toFixed(0)}% · IV {(drill.ivShock * 100).toFixed(0)}% · {fmtPnl(drill.totalPnl)}
                  </span>
                  <button type="button" onClick={() => setDrill(null)} style={{ border: "none", background: "none", color: "var(--text-lo)", cursor: "pointer" }}>×</button>
                </div>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {Object.entries(drill.byUnderlying).map(([u, v]) => (
                    <div key={u}>
                      <div style={{ fontSize: 10, color: "var(--text-lo)" }}>{u}</div>
                      <div className="num" style={{ fontSize: 12, color: pnlColor(v) }}>{fmtPnl(v)}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, maxHeight: 120, overflowY: "auto" }}>
                  {Object.entries(drill.byPosition).map(([id, v]) => {
                    const pos = positions.find(p => p.id === id);
                    return (
                      <div key={id} style={{ display: "flex", justifyContent: "space-between", fontSize: 10, padding: "2px 0", borderBottom: "1px solid var(--border-subtle)" }}>
                        <span style={{ color: "var(--text-mid)" }}>
                          {pos ? `${pos.underlying} ${pos.option_type} ${pos.strike}` : id.slice(0, 8)}
                        </span>
                        <span className="num" style={{ color: pnlColor(v) }}>{fmtPnl(v)}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
