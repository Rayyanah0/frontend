/**
 * Portfolio performance analytics over closed Position[] history.
 *
 * All metrics are pure functions — no I/O. Formulas are documented in
 * METRIC_TOOLTIPS and in the JSDoc on each exporter.
 *
 * Out of scope: benchmark comparison.
 */

import type { Position } from "./api/types";

export interface EquityPoint {
  /** Close timestamp (ms UTC). */
  t: number;
  date: string;
  /** Cumulative realized P&L after this trade. */
  equity: number;
  /** Drawdown from peak at this point (negative or zero). */
  drawdown: number;
  pnl: number;
}

export interface DrawdownStats {
  maxDrawdown: number;
  /** Duration of the max-drawdown trough in days (peak → recovery or end). */
  maxDrawdownDays: number;
}

export interface PerformanceStats {
  totalPnl: number;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;
  /** Gross wins / |gross losses|; Infinity when no losses. */
  profitFactor: number;
  /** Average P&L per trade. */
  expectancy: number;
  avgWin: number;
  avgLoss: number;
  maxDrawdown: number;
  maxDrawdownDays: number;
  /**
   * Sharpe-like ratio: mean(daily returns) / stdev(daily returns) * sqrt(365).
   * Daily returns are day-over-day changes in the equity curve, bucketed in UTC.
   * Returns 0 when fewer than 2 daily observations or zero variance.
   */
  sharpeLike: number;
}

export interface BreakdownRow {
  key: string;
  count: number;
  totalPnl: number;
  winRate: number;
}

export interface DateRange {
  from: number | null;
  to: number | null;
}

export const METRIC_TOOLTIPS: Record<string, string> = {
  totalPnl: "Sum of realized_pnl across closed and rolled trades in the selected range.",
  winRate: "Winning trades / total trades. A win is realized_pnl > 0.",
  profitFactor:
    "Gross wins ÷ |gross losses|. ∞ when there are wins and no losses; 0 when no wins.",
  expectancy: "Average realized P&L per trade (total P&L ÷ trade count).",
  maxDrawdown: "Largest peak-to-trough decline on the cumulative equity curve.",
  maxDrawdownDays: "Calendar days from the peak before the max drawdown to recovery (or series end).",
  sharpeLike:
    "mean(Δequity per UTC day) / stdev(Δequity per UTC day) × √365. Not a true Sharpe (no risk-free rate).",
  avgWin: "Average realized P&L of winning trades only.",
  avgLoss: "Average realized P&L of losing trades only (negative).",
};

function realized(p: Position): number {
  return p.realized_pnl ?? 0;
}

/** Closed + rolled positions with a close timestamp, oldest first. */
export function closedTrades(positions: Position[]): Position[] {
  return positions
    .filter(p => (p.status === "closed" || p.status === "rolled") && p.closed_at && p.realized_pnl !== null)
    .slice()
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());
}

export function filterByDateRange(trades: Position[], range: DateRange): Position[] {
  return trades.filter(t => {
    const ts = new Date(t.closed_at!).getTime();
    if (range.from != null && ts < range.from) return false;
    if (range.to != null && ts > range.to) return false;
    return true;
  });
}

export function equityCurve(trades: Position[]): EquityPoint[] {
  const sorted = closedTrades(trades);
  let equity = 0;
  let peak = 0;
  const points: EquityPoint[] = [];
  for (const t of sorted) {
    const pnl = realized(t);
    equity += pnl;
    if (equity > peak) peak = equity;
    const dd = equity - peak;
    const ms = new Date(t.closed_at!).getTime();
    points.push({
      t: ms,
      date: new Date(ms).toISOString().slice(0, 10),
      equity,
      drawdown: dd,
      pnl,
    });
  }
  return points;
}

export function drawdownStats(curve: EquityPoint[]): DrawdownStats {
  if (curve.length === 0) return { maxDrawdown: 0, maxDrawdownDays: 0 };

  let maxDrawdown = 0;
  let maxDrawdownDays = 0;
  let peakEquity = curve[0].equity;
  let peakT = curve[0].t;
  let troughEquity = curve[0].equity;
  let inDrawdown = false;

  for (const pt of curve) {
    if (pt.equity >= peakEquity) {
      if (inDrawdown) {
        const days = (pt.t - peakT) / (1000 * 60 * 60 * 24);
        const dd = troughEquity - peakEquity;
        if (dd < maxDrawdown) {
          maxDrawdown = dd;
          maxDrawdownDays = days;
        }
      }
      peakEquity = pt.equity;
      peakT = pt.t;
      troughEquity = pt.equity;
      inDrawdown = false;
    } else {
      inDrawdown = true;
      if (pt.equity < troughEquity) troughEquity = pt.equity;
      const dd = troughEquity - peakEquity;
      if (dd < maxDrawdown) {
        maxDrawdown = dd;
        maxDrawdownDays = (pt.t - peakT) / (1000 * 60 * 60 * 24);
      }
    }
  }

  return { maxDrawdown, maxDrawdownDays };
}

function dailyReturns(curve: EquityPoint[]): number[] {
  if (curve.length === 0) return [];
  // Bucket by UTC calendar day — last equity of each day.
  const byDay = new Map<string, number>();
  for (const pt of curve) {
    byDay.set(pt.date, pt.equity);
  }
  const days = Array.from(byDay.keys()).sort();
  const rets: number[] = [];
  let prev: number | null = null;
  for (const d of days) {
    const eq = byDay.get(d)!;
    if (prev !== null) rets.push(eq - prev);
    prev = eq;
  }
  return rets;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const v = xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function sharpeLike(curve: EquityPoint[]): number {
  const rets = dailyReturns(curve);
  const s = stdev(rets);
  if (s === 0 || rets.length < 2) return 0;
  return (mean(rets) / s) * Math.sqrt(365);
}

export function computeStats(trades: Position[]): PerformanceStats {
  const sorted = closedTrades(trades);
  const wins = sorted.filter(t => realized(t) > 0);
  const losses = sorted.filter(t => realized(t) < 0);
  const totalPnl = sorted.reduce((s, t) => s + realized(t), 0);
  const grossWins = wins.reduce((s, t) => s + realized(t), 0);
  const grossLosses = Math.abs(losses.reduce((s, t) => s + realized(t), 0));

  let profitFactor: number;
  if (grossLosses === 0) {
    profitFactor = grossWins > 0 ? Infinity : 0;
  } else {
    profitFactor = grossWins / grossLosses;
  }

  const curve = equityCurve(sorted);
  const dd = drawdownStats(curve);

  return {
    totalPnl,
    tradeCount: sorted.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRate: sorted.length === 0 ? 0 : wins.length / sorted.length,
    profitFactor,
    expectancy: sorted.length === 0 ? 0 : totalPnl / sorted.length,
    avgWin: wins.length === 0 ? 0 : grossWins / wins.length,
    avgLoss: losses.length === 0 ? 0 : -grossLosses / losses.length,
    maxDrawdown: dd.maxDrawdown,
    maxDrawdownDays: dd.maxDrawdownDays,
    sharpeLike: sharpeLike(curve),
  };
}

function bucketRows(trades: Position[], keyFn: (t: Position) => string): BreakdownRow[] {
  const map = new Map<string, Position[]>();
  for (const t of trades) {
    const k = keyFn(t);
    if (!map.has(k)) map.set(k, []);
    map.get(k)!.push(t);
  }
  return Array.from(map.entries())
    .map(([key, rows]) => {
      const totalPnl = rows.reduce((s, t) => s + realized(t), 0);
      const wins = rows.filter(t => realized(t) > 0).length;
      return { key, count: rows.length, totalPnl, winRate: rows.length ? wins / rows.length : 0 };
    })
    .sort((a, b) => b.totalPnl - a.totalPnl);
}

export function byUnderlying(trades: Position[]): BreakdownRow[] {
  return bucketRows(closedTrades(trades), t => t.underlying);
}

export function byOptionType(trades: Position[]): BreakdownRow[] {
  return bucketRows(closedTrades(trades), t => t.option_type);
}

export function byPositionType(trades: Position[]): BreakdownRow[] {
  return bucketRows(closedTrades(trades), t => t.position_type);
}

export function byStrategy(trades: Position[]): BreakdownRow[] {
  return bucketRows(closedTrades(trades), t => (t.strategy_id ? "strategy" : "single"));
}

/** Holding period in days (opened_at → closed_at), bucketed. */
export function holdingPeriodBucket(t: Position): string {
  if (!t.closed_at) return "unknown";
  const days = (new Date(t.closed_at).getTime() - new Date(t.opened_at).getTime()) / (1000 * 60 * 60 * 24);
  if (days < 1) return "<1d";
  if (days < 7) return "1–7d";
  if (days < 30) return "7–30d";
  if (days < 90) return "30–90d";
  return "90d+";
}

export function byHoldingPeriod(trades: Position[]): BreakdownRow[] {
  const order = ["<1d", "1–7d", "7–30d", "30–90d", "90d+", "unknown"];
  const rows = bucketRows(closedTrades(trades), holdingPeriodBucket);
  return rows.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
}

export function analyze(positions: Position[], range: DateRange = { from: null, to: null }) {
  const trades = filterByDateRange(closedTrades(positions), range);
  return {
    trades,
    curve: equityCurve(trades),
    stats: computeStats(trades),
    byUnderlying: byUnderlying(trades),
    byOptionType: byOptionType(trades),
    byPositionType: byPositionType(trades),
    byStrategy: byStrategy(trades),
    byHoldingPeriod: byHoldingPeriod(trades),
  };
}
