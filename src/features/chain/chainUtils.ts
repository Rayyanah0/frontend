import type { Position } from "../../lib/api/types";

export type StrikeWindowMode =
  | { type: "all" }
  | { type: "atm"; n: number }
  | { type: "delta"; min: number; max: number; side: "call" | "put" | "both" };

export interface ChainRowLike {
  strike: number;
  call: { delta: number };
  put: { delta: number };
  itmCall: boolean;
}

/** Index of the first OTM call row (ATM separator). -1 if none. */
export function findAtmIndex(rows: ChainRowLike[]): number {
  const idx = rows.findIndex(r => !r.itmCall);
  return idx;
}

/** ATM index within a filtered list, recomputed from ITM flags. */
export function findAtmIndexInFiltered(rows: ChainRowLike[]): number {
  return findAtmIndex(rows);
}

export function filterStrikeWindow<T extends ChainRowLike>(
  rows: T[],
  mode: StrikeWindowMode
): T[] {
  if (mode.type === "all" || rows.length === 0) return rows;

  if (mode.type === "atm") {
    const atm = findAtmIndex(rows);
    if (atm < 0) return rows;
    const lo = Math.max(0, atm - mode.n);
    const hi = Math.min(rows.length - 1, atm + mode.n);
    return rows.slice(lo, hi + 1);
  }

  // delta range: absolute delta in [min, max]
  const { min, max, side } = mode;
  return rows.filter(r => {
    const callOk = Math.abs(r.call.delta) >= min && Math.abs(r.call.delta) <= max;
    const putOk = Math.abs(r.put.delta) >= min && Math.abs(r.put.delta) <= max;
    if (side === "call") return callOk;
    if (side === "put") return putOk;
    return callOk || putOk;
  });
}

export type ChainColumnId =
  | "bid"
  | "ask"
  | "mid"
  | "iv"
  | "delta"
  | "gamma"
  | "theta"
  | "vega"
  | "intrinsic"
  | "timeValue"
  | "breakeven";

export interface ChainColumnDef {
  id: ChainColumnId;
  header: string;
  width: number;
  defaultOn: boolean;
}

export const CHAIN_COLUMNS: ChainColumnDef[] = [
  { id: "bid", header: "Bid", width: 64, defaultOn: true },
  { id: "ask", header: "Ask", width: 64, defaultOn: true },
  { id: "mid", header: "Mid", width: 64, defaultOn: false },
  { id: "iv", header: "IV", width: 52, defaultOn: true },
  { id: "delta", header: "Δ", width: 52, defaultOn: false },
  { id: "gamma", header: "Γ", width: 52, defaultOn: false },
  { id: "theta", header: "Θ", width: 52, defaultOn: false },
  { id: "vega", header: "V", width: 52, defaultOn: false },
  { id: "intrinsic", header: "Intr", width: 56, defaultOn: false },
  { id: "timeValue", header: "TV", width: 56, defaultOn: false },
  { id: "breakeven", header: "BE", width: 64, defaultOn: false },
];

const COL_PREF_KEY = "zenith.chain.columns.v1";

export function defaultColumnIds(): ChainColumnId[] {
  return CHAIN_COLUMNS.filter(c => c.defaultOn).map(c => c.id);
}

export function loadColumnPrefs(): ChainColumnId[] {
  if (typeof window === "undefined") return defaultColumnIds();
  try {
    const raw = localStorage.getItem(COL_PREF_KEY);
    if (!raw) return defaultColumnIds();
    const parsed = JSON.parse(raw) as string[];
    const valid = new Set(CHAIN_COLUMNS.map(c => c.id));
    const ids = parsed.filter((id): id is ChainColumnId => valid.has(id as ChainColumnId));
    return ids.length ? ids : defaultColumnIds();
  } catch {
    return defaultColumnIds();
  }
}

export function saveColumnPrefs(ids: ChainColumnId[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(COL_PREF_KEY, JSON.stringify(ids));
}

export function groupPositionsByStrategy(positions: Position[]) {
  const byId = new Map<string, Position[]>();
  const solos: Position[] = [];
  for (const p of positions) {
    if (!p.strategy_id) {
      solos.push(p);
      continue;
    }
    if (!byId.has(p.strategy_id)) byId.set(p.strategy_id, []);
    byId.get(p.strategy_id)!.push(p);
  }
  return { groups: Array.from(byId.entries()).map(([id, legs]) => ({ id, legs })), solos };
}
