// Pure roll-target suggestions for the guided roll wizard (#35).
import { bs, smileVol, type Greeks } from "./pricing";
import type { OptionType, PositionType } from "./api/types";

export interface RollPosition {
  underlying: string;
  strike: number;
  expiryDays: number;
  optionType: OptionType;
  positionType: PositionType;
  contracts: number;
  entryPremium: number;
  strategyId?: string | null;
}

export interface ChainStrike {
  strike: number;
  call?: { premium: number; delta: number };
  put?: { premium: number; delta: number };
}

export interface RollSuggestion {
  id: string;
  label: string;
  description: string;
  newStrike: number;
  newExpiryDays: number;
  kind: "out" | "up-and-out" | "down-and-out" | "delta-targeted" | "custom";
}

export interface RollChain {
  strikes: number[];
  expiries: number[];
  /** Optional live premiums/deltas keyed by strike for delta targeting. */
  entries?: ChainStrike[];
}

function snap(raw: number, strikes: number[]): number {
  if (strikes.length === 0) return raw;
  return strikes.reduce((best, s) =>
    Math.abs(s - raw) < Math.abs(best - raw) ? s : best
  );
}

function laterExpiries(current: number, expiries: number[]): number[] {
  return [...expiries].filter(d => d > current).sort((a, b) => a - b);
}

/**
 * Suggest common roll targets:
 *  - out: same strike, next later expiry
 *  - up-and-out: higher strike + later expiry
 *  - down-and-out: lower strike + later expiry
 *  - delta-targeted: strike nearest current |delta| on the later expiry
 */
export function suggestRolls(position: RollPosition, chain: RollChain): RollSuggestion[] {
  const later = laterExpiries(position.expiryDays, chain.expiries);
  if (later.length === 0) return [];

  const nextExpiry = later[0];
  const sorted = [...chain.strikes].sort((a, b) => a - b);
  const idx = sorted.findIndex(s => Math.abs(s - position.strike) < 1e-9);
  const upStrike = idx >= 0 && idx < sorted.length - 1
    ? sorted[idx + 1]
    : snap(position.strike * 1.05, sorted);
  const downStrike = idx > 0
    ? sorted[idx - 1]
    : snap(position.strike * 0.95, sorted);

  const suggestions: RollSuggestion[] = [
    {
      id: "out",
      label: "Roll out",
      description: `Same strike ${position.strike}, later expiry ${nextExpiry}D`,
      newStrike: snap(position.strike, sorted),
      newExpiryDays: nextExpiry,
      kind: "out",
    },
    {
      id: "up-and-out",
      label: "Roll up & out",
      description: `Higher strike → ${upStrike}, expiry ${nextExpiry}D`,
      newStrike: upStrike,
      newExpiryDays: nextExpiry,
      kind: "up-and-out",
    },
    {
      id: "down-and-out",
      label: "Roll down & out",
      description: `Lower strike → ${downStrike}, expiry ${nextExpiry}D`,
      newStrike: downStrike,
      newExpiryDays: nextExpiry,
      kind: "down-and-out",
    },
  ];

  // Delta-targeted: pick the strike on the later expiry whose BS delta is
  // closest to the current position's delta (absolute for shorts).
  if (sorted.length > 0) {
    const spotGuess = position.strike; // caller should pass real spot via entries
    const entry = chain.entries?.find(e => Math.abs(e.strike - position.strike) < 1e-9);
    const currentDelta = position.optionType === "call"
      ? (entry?.call?.delta ?? 0.5)
      : (entry?.put?.delta ?? -0.5);

    let bestStrike = sorted[0];
    let bestDist = Infinity;
    for (const s of sorted) {
      const e = chain.entries?.find(x => Math.abs(x.strike - s) < 1e-9);
      const d = position.optionType === "call"
        ? (e?.call?.delta ?? estimateDelta(spotGuess, s, nextExpiry, true))
        : (e?.put?.delta ?? estimateDelta(spotGuess, s, nextExpiry, false));
      const dist = Math.abs(d - currentDelta);
      if (dist < bestDist) { bestDist = dist; bestStrike = s; }
    }

    suggestions.push({
      id: "delta-targeted",
      label: "Delta-targeted",
      description: `Match Δ≈${currentDelta.toFixed(2)} → K=${bestStrike}, ${nextExpiry}D`,
      newStrike: bestStrike,
      newExpiryDays: nextExpiry,
      kind: "delta-targeted",
    });
  }

  return suggestions;
}

function estimateDelta(spot: number, strike: number, days: number, isCall: boolean): number {
  const vol = smileVol(0.5, strike / Math.max(spot, 1e-9));
  return bs(Math.max(spot, 1e-9), strike, vol, days / 365, isCall).delta;
}

export interface RollComparison {
  oldPremium: number;
  newPremium: number;
  oldGreeks: Greeks;
  newGreeks: Greeks;
  oldBreakeven: number;
  newBreakeven: number;
  oldCollateral: number;
  newCollateral: number;
  oldDays: number;
  newDays: number;
  /** Positive = net credit to the account from the roll. */
  netCredit: number;
  postRollBalance: number;
}

export function compareRoll(
  position: RollPosition,
  spot: number,
  vol: number,
  newStrike: number,
  newExpiryDays: number,
  balance: number,
  currentPremiumTotal: number,
  collateralRequired: (side: OptionType, contracts: number, strike: number, spot: number) => number
): RollComparison {
  const isCall = position.optionType === "call";
  const oldVol = smileVol(vol, position.strike / Math.max(spot, 1e-9));
  const newVol = smileVol(vol, newStrike / Math.max(spot, 1e-9));
  const oldGreeks = bs(spot, position.strike, oldVol, position.expiryDays / 365, isCall);
  const newGreeks = bs(spot, newStrike, newVol, newExpiryDays / 365, isCall);

  const oldPremium = currentPremiumTotal;
  const newPremium = newGreeks.premium * position.contracts;
  const oldCollateral = position.positionType === "short"
    ? collateralRequired(position.optionType, position.contracts, position.strike, spot) : 0;
  const newCollateral = position.positionType === "short"
    ? collateralRequired(position.optionType, position.contracts, newStrike, spot) : 0;

  const closeCash = position.positionType === "short"
    ? oldCollateral - oldPremium
    : oldPremium;
  const openCash = position.positionType === "short"
    ? newPremium - newCollateral
    : -newPremium;
  const netCredit = closeCash + openCash;

  const beOffset = oldGreeks.premium;
  const oldBreakeven = isCall ? position.strike + beOffset : position.strike - beOffset;
  const newBreakeven = isCall ? newStrike + newGreeks.premium : newStrike - newGreeks.premium;

  return {
    oldPremium, newPremium, oldGreeks, newGreeks,
    oldBreakeven, newBreakeven, oldCollateral, newCollateral,
    oldDays: position.expiryDays, newDays: newExpiryDays,
    netCredit, postRollBalance: balance + netCredit,
  };
}
