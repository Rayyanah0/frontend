import type { Position } from "../api/types";

/** Quantity step for partial closes (contracts). */
export const CONTRACT_STEP = 0.01;

export function clampCloseQty(requested: number, available: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return CONTRACT_STEP;
  const stepped = Math.round(requested / CONTRACT_STEP) * CONTRACT_STEP;
  return Math.min(Math.max(CONTRACT_STEP, stepped), available);
}

/**
 * Preview realized P&L for closing `qty` of `contracts` at the current mark.
 * Mirrors portfolio marking: long profits when mark > entry; short when mark < entry.
 */
export function previewPartialClosePnl(
  position: Pick<Position, "contracts" | "entry_premium" | "position_type">,
  currentPremiumPerContract: number,
  qty: number
): { closedQty: number; entryTotal: number; exitTotal: number; realizedPnl: number; remaining: number } {
  const closedQty = clampCloseQty(qty, position.contracts);
  const entryTotal = position.entry_premium * closedQty;
  const exitTotal = currentPremiumPerContract * closedQty;
  const realizedPnl =
    position.position_type === "short" ? entryTotal - exitTotal : exitTotal - entryTotal;
  return {
    closedQty,
    entryTotal,
    exitTotal,
    realizedPnl,
    remaining: Math.round((position.contracts - closedQty) / CONTRACT_STEP) * CONTRACT_STEP,
  };
}

export function aggregateClosePreview(
  items: Array<{
    entryPremiumTotal: number;
    currentPremium: number;
    pnl: number;
    collateral: number;
  }>
) {
  return {
    totalPremium: items.reduce((s, i) => s + i.currentPremium, 0),
    totalEntryPremium: items.reduce((s, i) => s + i.entryPremiumTotal, 0),
    realizedPnl: items.reduce((s, i) => s + i.pnl, 0),
    collateralReleased: items.reduce((s, i) => s + i.collateral, 0),
    count: items.length,
  };
}
