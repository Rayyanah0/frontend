"use client";

import { useMemo, useState } from "react";
import type { Position } from "../lib/api/types";
import {
  analyze,
  METRIC_TOOLTIPS,
  type DateRange,
  type EquityPoint,
} from "../lib/analytics";
import { fmtN } from "../lib/pricing";

function EquityCurveChart({ curve, width = 720, height = 180 }: { curve: EquityPoint[]; width?: number; height?: number }) {
  const PAD = { t: 10, r: 10, b: 24, l: 44 };
  const W = width - PAD.l - PAD.r;
  const H = height - PAD.t - PAD.b;

  if (curve.length < 2) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-lo)", fontSize: 12 }}>
        Need at least two closed trades for an equity curve.
      </div>
    );
  }

  const equity = curve.map(p => p.equity);
  const dd = curve.map(p => p.drawdown);
  const lo = Math.min(0, ...equity, ...dd);
  const hi = Math.max(0, ...equity);
  const range = Math.max(hi - lo, 1e-6);
  const toX = (i: number) => (i / (curve.length - 1)) * W;
  const toY = (v: number) => H - ((v - lo) / range) * H;
  const eqPath = curve.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.equity).toFixed(1)}`).join(" ");
  const ddPath =
    curve.map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.drawdown).toFixed(1)}`).join(" ") +
    ` L${toX(curve.length - 1).toFixed(1)},${toY(0).toFixed(1)} L0,${toY(0).toFixed(1)} Z`;
  const last = curve[curve.length - 1];
  const up = last.equity >= 0;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} aria-label="Equity curve with drawdown underlay">
      <g transform={`translate(${PAD.l},${PAD.t})`}>
        <line x1={0} y1={toY(0)} x2={W} y2={toY(0)} stroke="var(--border-default)" strokeWidth={1} />
        <path d={ddPath} fill="rgba(182,86,64,0.18)" />
        <path d={eqPath} fill="none" stroke={up ? "var(--call)" : "var(--put)"} strokeWidth={1.75} strokeLinejoin="round" />
        <text x={-6} y={toY(hi) + 4} textAnchor="end" fill="var(--text-lo)" fontSize={9} fontFamily="var(--font-mono)">
          ${fmtN(hi, 0)}
        </text>
        <text x={-6} y={toY(lo) + 4} textAnchor="end" fill="var(--text-lo)" fontSize={9} fontFamily="var(--font-mono)">
          ${fmtN(lo, 0)}
        </text>
        <text x={0} y={H + 16} fill="var(--text-lo)" fontSize={9}>
          {curve[0].date}
        </text>
        <text x={W} y={H + 16} textAnchor="end" fill="var(--text-lo)" fontSize={9}>
          {last.date}
        </text>
      </g>
    </svg>
  );
}

function StatCard({ label, value, color, tip }: { label: string; value: string; color: string; tip: string }) {
  return (
    <div title={tip} style={{ flex: 1, minWidth: 120, padding: "12px 14px", borderRight: "1px solid var(--border-default)" }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 6, cursor: "help" }}>
        {label}
      </div>
      <div className="num" style={{ fontSize: 16, fontWeight: 600, color }}>{value}</div>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: { key: string; count: number; totalPnl: number; winRate: number }[] }) {
  return (
    <div style={{ flex: 1, minWidth: 200, border: "1px solid var(--border-subtle)", background: "var(--bg-elevated)" }}>
      <div style={{ padding: "8px 12px", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", borderBottom: "1px solid var(--border-subtle)" }}>
        {title}
      </div>
      {rows.length === 0 ? (
        <div style={{ padding: 12, fontSize: 11, color: "var(--text-lo)" }}>No data</div>
      ) : (
        rows.map(r => (
          <div key={r.key} style={{ display: "flex", justifyContent: "space-between", padding: "6px 12px", borderBottom: "1px solid var(--border-subtle)", fontSize: 11 }}>
            <span style={{ color: "var(--text-hi)", textTransform: "capitalize" }}>{r.key} <span style={{ color: "var(--text-lo)" }}>({r.count})</span></span>
            <span className="num" style={{ color: r.totalPnl >= 0 ? "var(--call)" : "var(--put)" }}>
              {r.totalPnl >= 0 ? "+" : "−"}${fmtN(Math.abs(r.totalPnl), 2)} · {(r.winRate * 100).toFixed(0)}%
            </span>
          </div>
        ))
      )}
    </div>
  );
}

const RANGES: { label: string; days: number | null }[] = [
  { label: "7D", days: 7 },
  { label: "30D", days: 30 },
  { label: "90D", days: 90 },
  { label: "All", days: null },
];

export function PerformanceAnalytics({ trades }: { trades: Position[] }) {
  const [rangeDays, setRangeDays] = useState<number | null>(null);

  const range: DateRange = useMemo(() => {
    if (rangeDays == null) return { from: null, to: null };
    return { from: Date.now() - rangeDays * 86400000, to: null };
  }, [rangeDays]);

  const data = useMemo(() => analyze(trades, range), [trades, range]);
  const s = data.stats;

  const fmtPf = (n: number) => (!Number.isFinite(n) ? "∞" : n.toFixed(2));
  const fmtMoney = (n: number) => `${n >= 0 ? "+" : "−"}$${fmtN(Math.abs(n), 2)}`;

  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 18, fontWeight: 600, marginBottom: 2 }}>Performance Analytics</h2>
          <p style={{ fontSize: 12, color: "var(--text-mid)" }}>
            Equity curve, drawdown, and trade statistics from realized history. Hover a stat for its formula.
          </p>
        </div>
        <div style={{ display: "flex", gap: 2 }} role="group" aria-label="Date range selection">
          {RANGES.map(r => (
            <button
              key={r.label}
              aria-label={`Filter analytics to ${r.label}`}
              aria-pressed={rangeDays === r.days}
              onClick={() => setRangeDays(r.days)}
              style={{
                padding: "4px 10px", border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600,
                background: rangeDays === r.days ? "var(--atm-dim)" : "transparent",
                color: rangeDays === r.days ? "var(--atm)" : "var(--text-lo)",
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", border: "1px solid var(--border-default)", background: "var(--bg-raised)", marginBottom: 12, overflowX: "auto" }}>
        <StatCard label="Total P&L" value={fmtMoney(s.totalPnl)} color={s.totalPnl >= 0 ? "var(--call)" : "var(--put)"} tip={METRIC_TOOLTIPS.totalPnl} />
        <StatCard label="Win Rate" value={`${(s.winRate * 100).toFixed(0)}%`} color="var(--atm)" tip={METRIC_TOOLTIPS.winRate} />
        <StatCard label="Profit Factor" value={fmtPf(s.profitFactor)} color="var(--text-hi)" tip={METRIC_TOOLTIPS.profitFactor} />
        <StatCard label="Expectancy" value={fmtMoney(s.expectancy)} color={s.expectancy >= 0 ? "var(--call)" : "var(--put)"} tip={METRIC_TOOLTIPS.expectancy} />
        <StatCard label="Max DD" value={fmtMoney(s.maxDrawdown)} color="var(--put)" tip={METRIC_TOOLTIPS.maxDrawdown} />
        <StatCard label="DD Days" value={s.maxDrawdownDays.toFixed(1)} color="var(--text-mid)" tip={METRIC_TOOLTIPS.maxDrawdownDays} />
        <StatCard label="Sharpe-like" value={s.sharpeLike.toFixed(2)} color="var(--text-hi)" tip={METRIC_TOOLTIPS.sharpeLike} />
      </div>

      <div style={{ border: "1px solid var(--border-default)", background: "var(--bg-raised)", padding: "12px 14px", marginBottom: 16 }}>
        <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--text-lo)", marginBottom: 8 }}>
          Equity curve · drawdown underlay
        </div>
        <EquityCurveChart curve={data.curve} />
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <BreakdownTable title="By underlying" rows={data.byUnderlying} />
        <BreakdownTable title="Call vs put" rows={data.byOptionType} />
        <BreakdownTable title="Long vs short" rows={data.byPositionType} />
        <BreakdownTable title="Strategy vs single" rows={data.byStrategy} />
        <BreakdownTable title="Holding period" rows={data.byHoldingPeriod} />
      </div>
    </div>
  );
}
