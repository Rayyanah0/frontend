import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Alert, AlertCondition, Position, WatchlistItem } from "./api/types";
import type { OpenPositionParams } from "./api/positions";

// ---- Pure optimistic transforms (unit-testable, no React/QueryClient) ----

export function removePositionById(positions: Position[], id: string): Position[] {
  return positions.filter(p => p.id !== id);
}

/** Placeholder row for a just-submitted open; replaced by the server row on settle. */
export function placeholderPosition(p: OpenPositionParams, tempId: string): Position {
  return {
    id: tempId, wallet_address: "", underlying: p.underlying, strike: p.strike,
    expiry_days: p.expiryDays, option_type: p.optionType, position_type: p.positionType,
    contracts: p.contracts, entry_premium: 0, entry_spot: 0, collateral: 0, status: "open",
    close_premium: null, close_spot: null, realized_pnl: null,
    opened_at: new Date().toISOString(), closed_at: null, strategy_id: null,
  };
}

export function addPosition(positions: Position[], p: Position): Position[] {
  return [...positions, p];
}

export function addWatchlistItem(items: WatchlistItem[], underlying: string): WatchlistItem[] {
  if (items.some(i => i.underlying === underlying)) return items;
  return [...items, { wallet_address: "", underlying, added_at: new Date().toISOString() }];
}

export function removeWatchlistItem(items: WatchlistItem[], underlying: string): WatchlistItem[] {
  return items.filter(i => i.underlying !== underlying);
}

export function addAlertItem(
  alerts: Alert[],
  a: { underlying: string; condition: AlertCondition; targetPrice: number },
  tempId: string
): Alert[] {
  return [...alerts, {
    id: tempId, wallet_address: "", underlying: a.underlying, condition: a.condition,
    target_price: a.targetPrice, triggered: false, created_at: new Date().toISOString(), triggered_at: null,
  }];
}

export function removeAlertById(alerts: Alert[], id: string): Alert[] {
  return alerts.filter(a => a.id !== id);
}

// ---- onMutate / onError helpers implementing snapshot + rollback ----

let tempCounter = 0;
export const tempId = () => `optimistic-${Date.now()}-${tempCounter++}`;

/**
 * Optimistically patches one query and returns the snapshot used for
 * rollback. In-flight fetches for the key are cancelled first so a slower
 * refetch (or WebSocket-driven update) can't overwrite the optimistic
 * value mid-mutation.
 */
export async function applyOptimistic<T>(
  qc: QueryClient, key: QueryKey, transform: (old: T) => T, fallback: T
): Promise<{ key: QueryKey; snapshot: T | undefined }> {
  await qc.cancelQueries({ queryKey: key });
  const snapshot = qc.getQueryData<T>(key);
  qc.setQueryData<T>(key, transform(snapshot ?? fallback));
  return { key, snapshot };
}

/**
 * Restore the snapshot on failure — unless another mutation of the same
 * kind is still in flight (concurrent mutations on one entity): restoring
 * would clobber its optimistic state, so we leave it to the settle-time
 * invalidation to reconcile with the server.
 */
export function rollback<T>(
  qc: QueryClient, ctx: { key: QueryKey; snapshot: T | undefined } | undefined, mutationKey: QueryKey
) {
  if (!ctx || qc.isMutating({ mutationKey }) > 1) return;
  qc.setQueryData(ctx.key, ctx.snapshot);
}
