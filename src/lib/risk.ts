// Whole-portfolio risk: combines every open position on an underlying
// (solo trades and strategy legs alike — payoff.ts otherwise only ever
// sees the legs of a single strategy being previewed) into one payoff
// curve, and stress-tests the entire account across a spot-shock grid.
import type { Position } from "./api/types";
import { combinedPnl, combinedPayoffSeries, type PricedLeg } from "./payoff";
import { bs, smileVol } from "./pricing";

// entry_premium stands in for the leg's greeks.premium here — payoff math
// only ever reads .premium off the greeks object, and P&L should be
// measured against what was actually paid/collected at entry, not a
// freshly repriced premium.
export function positionsToLegs(positions: Position[]): PricedLeg[] {
  return positions.map(p => ({
    side: p.option_type,
    action: p.position_type === "short" ? "sell" : "buy",
    strike: p.strike,
    contracts: p.contracts,
    expiryDays: p.expiry_days,
    greeks: { premium: p.entry_premium, delta: 0, gamma: 0, theta: 0, vega: 0, iv: 0 },
  }));
}

export function groupPositionsByUnderlying(positions: Position[]): Map<string, Position[]> {
  const groups = new Map<string, Position[]>();
  for (const p of positions) {
    if (!groups.has(p.underlying)) groups.set(p.underlying, []);
    groups.get(p.underlying)!.push(p);
  }
  return groups;
}

export interface RiskProfile {
  breakevens: number[];
  maxProfit: number;
  maxProfitUnlimited: boolean;
  maxLoss: number;
  maxLossUnlimited: boolean;
}

// Wide range + endpoint slope is a cheap way to tell "capped by the
// chain's strikes" apart from "genuinely unbounded" (net long calls/short
// calls) without symbolically analyzing the leg set.
export function riskProfile(legs: PricedLeg[], spot: number): RiskProfile {
  if (legs.length === 0 || spot <= 0) {
    return { breakevens: [], maxProfit: 0, maxProfitUnlimited: false, maxLoss: 0, maxLossUnlimited: false };
  }
  const series = combinedPayoffSeries(legs, spot * 0.2, spot * 3, 400);

  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  const breakevens: number[] = [];
  for (let i = 0; i < series.length; i++) {
    const pt = series[i];
    if (pt.p > maxProfit) maxProfit = pt.p;
    if (pt.p < maxLoss) maxLoss = pt.p;
    if (i > 0) {
      const prev = series[i - 1];
      if ((prev.p < 0 && pt.p >= 0) || (prev.p > 0 && pt.p <= 0)) {
        const frac = prev.p === pt.p ? 0 : -prev.p / (pt.p - prev.p);
        breakevens.push(prev.s + frac * (pt.s - prev.s));
      }
    }
  }

  const last = series[series.length - 1];
  const prevLast = series[series.length - 2];
  const tailSlope = last.p - prevLast.p;
  return {
    breakevens,
    maxProfit, maxProfitUnlimited: tailSlope > 1e-6,
    maxLoss, maxLossUnlimited: tailSlope < -1e-6,
  };
}

export const STRESS_SHOCKS = [-0.2, -0.1, -0.05, 0, 0.05, 0.1, 0.2];

export interface StressResult {
  shock: number;
  totalPnl: number;
  byUnderlying: Record<string, number>;
}

// Default stress P&L is still intrinsic-at-expiry (shock the spot, run to
// expiry). For live mark-to-model curves see markToModelPnl in payoff.ts
// and the time-aware controls on MultiLegPayoffDiagram / PortfolioRiskPanel.
export function stressTestPortfolio(positions: Position[], spots: Record<string, number>): StressResult[] {
  const groups = groupPositionsByUnderlying(positions);
  return STRESS_SHOCKS.map(shock => {
    const byUnderlying: Record<string, number> = {};
    let totalPnl = 0;
    for (const [underlying, posns] of Array.from(groups.entries())) {
      const spot = spots[underlying] ?? 0;
      const pnl = combinedPnl(positionsToLegs(posns), spot * (1 + shock));
      byUnderlying[underlying] = pnl;
      totalPnl += pnl;
    }
    return { shock, totalPnl, byUnderlying };
  });
}

export interface ScenarioAxis {
  /** Inclusive list of spot shocks, e.g. [-0.3, …, 0.3]. */
  spotShocks: number[];
  /** Inclusive list of IV shocks (relative), e.g. [-0.5, …, 1.0]. */
  ivShocks: number[];
  /** Calendar days to roll the clock forward before repricing. */
  daysForward: number;
}

export type ScenarioMode = "correlated" | "independent";

export interface ScenarioCell {
  spotShock: number;
  ivShock: number;
  totalPnl: number;
  byUnderlying: Record<string, number>;
  byPosition: Record<string, number>;
}

export interface ScenarioGridResult {
  spotShocks: number[];
  ivShocks: number[];
  daysForward: number;
  mode: ScenarioMode;
  cells: ScenarioCell[];
  /** Index into cells of the minimum totalPnl (worst case). */
  worstIndex: number;
  elapsedMs: number;
}

function clampVol(v: number): number {
  return Math.max(0.01, v);
}

/** Mark-to-model P&L for one position under spot/vol/time shocks. */
export function scenarioPositionPnl(
  pos: Position,
  spot: number,
  baseVol: number,
  spotShock: number,
  ivShock: number,
  daysForward: number
): number {
  if (!Number.isFinite(spot) || spot <= 0) return 0;
  const shockedSpot = spot * (1 + spotShock);
  const shockedVol = clampVol(baseVol * (1 + ivShock));
  const t = Math.max(0, (pos.expiry_days - daysForward) / 365);
  const vol = smileVol(shockedVol, pos.strike / shockedSpot);
  const g = bs(shockedSpot, pos.strike, vol, t, pos.option_type === "call");
  const entryTotal = pos.entry_premium * pos.contracts;
  const current = g.premium * pos.contracts;
  return pos.position_type === "short" ? entryTotal - current : current - entryTotal;
}

/**
 * Full mark-to-model scenario grid (spot × IV), optionally correlated
 * across underlyings. Designed to run inside the quant worker for large books.
 */
export function scenarioGrid(
  positions: Position[],
  spots: Record<string, number>,
  vols: Record<string, number>,
  axis: ScenarioAxis,
  mode: ScenarioMode = "correlated"
): ScenarioGridResult {
  const t0 = typeof performance !== "undefined" ? performance.now() : Date.now();
  const { spotShocks, ivShocks, daysForward } = axis;
  const cells: ScenarioCell[] = [];
  let worstIndex = 0;
  let worstPnl = Infinity;

  for (const spotShock of spotShocks) {
    for (const ivShock of ivShocks) {
      const byUnderlying: Record<string, number> = {};
      const byPosition: Record<string, number> = {};
      let totalPnl = 0;

      for (const pos of positions) {
        const spot = spots[pos.underlying];
        const baseVol = vols[pos.underlying] ?? 0.5;
        // Correlated: same (spot, iv) shock on every underlying.
        // Independent: only the first underlying in the book is shocked;
        // others stay at the zero-shock MTM (callers that need a full
        // per-name grid pass a filtered position set).
        let sShock = spotShock;
        let vShock = ivShock;
        if (mode === "independent") {
          const first = positions[0]?.underlying;
          if (pos.underlying !== first) {
            sShock = 0;
            vShock = 0;
          }
        }
        const pnl = scenarioPositionPnl(pos, spot ?? 0, baseVol, sShock, vShock, daysForward);
        byPosition[pos.id] = pnl;
        byUnderlying[pos.underlying] = (byUnderlying[pos.underlying] ?? 0) + pnl;
        totalPnl += pnl;
      }

      if (totalPnl < worstPnl) {
        worstPnl = totalPnl;
        worstIndex = cells.length;
      }
      cells.push({ spotShock, ivShock, totalPnl, byUnderlying, byPosition });
    }
  }

  const t1 = typeof performance !== "undefined" ? performance.now() : Date.now();
  return {
    spotShocks,
    ivShocks,
    daysForward,
    mode,
    cells,
    worstIndex,
    elapsedMs: t1 - t0,
  };
}

/** Default 15×15 axes: spot −30%…+30%, IV −50%…+100%. */
export function defaultScenarioAxis(daysForward = 1): ScenarioAxis {
  const spotShocks: number[] = [];
  for (let i = 0; i < 15; i++) spotShocks.push(-0.3 + (0.6 * i) / 14);
  const ivShocks: number[] = [];
  for (let i = 0; i < 15; i++) ivShocks.push(-0.5 + (1.5 * i) / 14);
  return { spotShocks, ivShocks, daysForward };
}
