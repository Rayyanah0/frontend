import type { Greeks } from "./pricing";
import type { OptionChainEntry } from "./api/types";

export interface ChainRowData {
  strike: number;
  call: Greeks;
  put: Greeks;
  itmCall: boolean;
  itmPut: boolean;
}

const sideEqual = (a: Greeks, b: Greeks) =>
  a.premium === b.premium && a.delta === b.delta && a.gamma === b.gamma &&
  a.theta === b.theta && a.vega === b.vega && a.iv === b.iv;

const pick = (r: OptionChainEntry["call"]): Greeks => ({
  premium: r.premium, delta: r.delta, gamma: r.gamma, theta: r.theta, vega: r.vega, iv: r.iv,
});

export function entryToRow(e: OptionChainEntry): ChainRowData {
  return { strike: e.strike, call: pick(e.call), put: pick(e.put), itmCall: e.is_itm_call, itmPut: e.is_itm_put };
}

/**
 * Structural-sharing merge: rows (and their call/put sides) whose values are
 * unchanged keep their previous object identity so memoized rows skip
 * re-rendering. Returns `prev` itself when nothing changed. Rows are matched by
 * strike, so a changed strike set (spot moved far) just adds/drops rows.
 */
export function mergeChain(prev: ChainRowData[], next: ChainRowData[]): ChainRowData[] {
  const byStrike = new Map(prev.map((r) => [r.strike, r]));
  let changed = prev.length !== next.length;
  const out = next.map((n, i) => {
    const p = byStrike.get(n.strike);
    if (!p) { changed = true; return n; }
    if (prev[i] !== p) changed = true;
    if (sideEqual(p.call, n.call) && sideEqual(p.put, n.put) && p.itmCall === n.itmCall && p.itmPut === n.itmPut) return p;
    changed = true;
    return {
      ...n,
      call: sideEqual(p.call, n.call) ? p.call : n.call,
      put: sideEqual(p.put, n.put) ? p.put : n.put,
    };
  });
  return changed ? out : prev;
}
