import { bs, smileVol, type Greeks } from "./pricing";

export interface PricedLeg {
  side: "call" | "put";
  action: "buy" | "sell";
  strike: number;
  contracts: number;
  greeks: Greeks;
  /** Days to expiry at entry / current remaining life. Required for mark-to-model. */
  expiryDays?: number;
  /** Base IV used when pricing this leg (before ivShift). Defaults to greeks.iv. */
  iv?: number;
}

/** Net P&L across all legs at a given spot price at expiry (intrinsic). */
export function combinedPnl(legs: PricedLeg[], spotAtExpiry: number): number {
  return legs.reduce((total, leg) => {
    const intrinsic = leg.side === "call"
      ? Math.max(0, spotAtExpiry - leg.strike)
      : Math.max(0, leg.strike - spotAtExpiry);
    const perContract = leg.action === "buy" ? intrinsic - leg.greeks.premium : leg.greeks.premium - intrinsic;
    return total + perContract * leg.contracts;
  }, 0);
}

/**
 * Mark-to-model P&L at an arbitrary forward date before expiry.
 * tForwardDays = days from now (0 = today). ivShift is a relative multiplier
 * on each leg's IV (−0.5 = −50%, +1.0 = +100%).
 *
 * When remaining time ≤ 0 the leg collapses to intrinsic (same as combinedPnl).
 */
export function markToModelPnl(
  legs: PricedLeg[],
  spot: number,
  tForwardDays: number,
  ivShift = 0,
  baseVol = 0.5
): number {
  return legs.reduce((total, leg) => {
    const expiryDays = leg.expiryDays ?? 0;
    const remainingDays = Math.max(0, expiryDays - tForwardDays);
    const entryPremium = leg.greeks.premium;
    let mark: number;
    if (remainingDays <= 1e-9) {
      mark = leg.side === "call"
        ? Math.max(0, spot - leg.strike)
        : Math.max(0, leg.strike - spot);
    } else {
      const baseIv = leg.iv ?? (leg.greeks.iv > 0 ? leg.greeks.iv : smileVol(baseVol, leg.strike / Math.max(spot, 1e-12)));
      const iv = Math.max(0.01, baseIv * (1 + ivShift));
      const t = remainingDays / 365;
      mark = bs(spot, leg.strike, iv, t, leg.side === "call").premium;
    }
    const perContract = leg.action === "buy" ? mark - entryPremium : entryPremium - mark;
    return total + perContract * leg.contracts;
  }, 0);
}

/** Aggregate live Greeks at a given forward date / IV shift (for crosshair). */
export function markToModelGreeks(
  legs: PricedLeg[],
  spot: number,
  tForwardDays: number,
  ivShift = 0,
  baseVol = 0.5
): Greeks {
  return legs.reduce(
    (acc, leg) => {
      const expiryDays = leg.expiryDays ?? 0;
      const remainingDays = Math.max(0, expiryDays - tForwardDays);
      const sign = leg.action === "buy" ? 1 : -1;
      if (remainingDays <= 1e-9) {
        const delta = leg.side === "call"
          ? (spot > leg.strike ? 1 : spot < leg.strike ? 0 : 0.5)
          : (spot < leg.strike ? -1 : spot > leg.strike ? 0 : -0.5);
        acc.delta += sign * delta * leg.contracts;
        return acc;
      }
      const baseIv = leg.iv ?? (leg.greeks.iv > 0 ? leg.greeks.iv : smileVol(baseVol, leg.strike / Math.max(spot, 1e-12)));
      const iv = Math.max(0.01, baseIv * (1 + ivShift));
      const g = bs(spot, leg.strike, iv, remainingDays / 365, leg.side === "call");
      acc.premium += sign * g.premium * leg.contracts;
      acc.delta += sign * g.delta * leg.contracts;
      acc.gamma += sign * g.gamma * leg.contracts;
      acc.theta += sign * g.theta * leg.contracts;
      acc.vega += sign * g.vega * leg.contracts;
      acc.iv = iv;
      return acc;
    },
    { premium: 0, delta: 0, gamma: 0, theta: 0, vega: 0, iv: 0 } as Greeks
  );
}

/** Series of {s, p} points across a spot range, for charting the combined curve. */
export function combinedPayoffSeries(legs: PricedLeg[], loSpot: number, hiSpot: number, steps = 200) {
  const range = hiSpot - loSpot;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const s = loSpot + (range * i) / steps;
    return { s, p: combinedPnl(legs, s) };
  });
}

/** Mark-to-model series at a fixed forward date / IV shift. */
export function markToModelSeries(
  legs: PricedLeg[],
  loSpot: number,
  hiSpot: number,
  tForwardDays: number,
  ivShift = 0,
  baseVol = 0.5,
  steps = 200
) {
  const range = hiSpot - loSpot;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const s = loSpot + (range * i) / steps;
    return { s, p: markToModelPnl(legs, s, tForwardDays, ivShift, baseVol) };
  });
}

/** Positive = net debit paid to enter; negative = net credit received. */
export function netPremium(legs: PricedLeg[]): number {
  return legs.reduce(
    (total, leg) => total + (leg.action === "buy" ? leg.greeks.premium : -leg.greeks.premium) * leg.contracts,
    0
  );
}

/** Nearest remaining expiry across legs — bounds the days-forward slider. */
export function nearestExpiryDays(legs: PricedLeg[]): number {
  const days = legs.map(l => l.expiryDays ?? 0).filter(d => d > 0);
  return days.length === 0 ? 0 : Math.min(...days);
}
