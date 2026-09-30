"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getCombinedPayoff } from "../api/payoff";
import { combinedPayoffSeries, type PricedLeg } from "../payoff";

export type PayoffSource = "backend" | "local";
export interface PayoffPt { s: number; p: number }

const DEBOUNCE_MS = 300;
const STEPS = 200;
// Relative to the largest |pnl| in the curve, so XLM-scale (~0.1) and BTC-scale prices both work.
const PARITY_REL_TOL = 1e-3;
const PARITY_ABS_TOL = 1e-6;

/** Max absolute difference between two series (compared by index; both use the same grid). */
export function maxSeriesDiff(a: PayoffPt[], b: PayoffPt[]): number {
  const n = Math.min(a.length, b.length);
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(a[i].p - b[i].p));
  return m;
}

/**
 * Payoff curve for `legs` over [lo, hi]. The backend /api/v1/portfolio/payoff
 * is the source of truth (debounced as legs change, stale requests dropped);
 * src/lib/payoff.ts is the fallback when it fails, and the local curve is what
 * shows while the first request is in flight. The previous curve stays visible
 * while `loading`. In development the two are compared and a console warning
 * is emitted when the max absolute difference exceeds the tolerance.
 */
export function usePayoffSeries(legs: PricedLeg[], lo: number, hi: number) {
  const local = useMemo(() => combinedPayoffSeries(legs, lo, hi, STEPS), [legs, lo, hi]);
  const [remote, setRemote] = useState<{ points: PayoffPt[]; forLocal: PayoffPt[] } | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const id = ++reqId.current; // any earlier in-flight request is now stale
    if (legs.length === 0 || !(hi > lo)) { setRemote(null); setLoading(false); setFailed(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const res = await getCombinedPayoff({
          legs: legs.map((l) => ({
            optionType: l.side, positionType: l.action === "buy" ? "long" : "short",
            strike: l.strike, contracts: l.contracts, premium: l.greeks.premium,
          })),
          loSpot: lo, hiSpot: hi, steps: STEPS,
        });
        if (id !== reqId.current) return;
        const points = res.points.map((pt) => ({ s: pt.spot, p: pt.pnl }));
        setRemote({ points, forLocal: local });
        setFailed(false);
        if (process.env.NODE_ENV !== "production") {
          const diff = maxSeriesDiff(points, local);
          const scale = local.reduce((m, pt) => Math.max(m, Math.abs(pt.p)), 0);
          if (diff > Math.max(PARITY_ABS_TOL, scale * PARITY_REL_TOL)) {
            console.warn(`[payoff parity] local vs backend max |diff| = ${diff} exceeds tolerance`, { legs });
          }
        }
      } catch {
        if (id !== reqId.current) return;
        setFailed(true);
      } finally {
        if (id === reqId.current) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // `local` is derived from the same inputs; excluded to avoid double-firing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [legs, lo, hi]);

  const useRemote = !failed && remote !== null && legs.length > 0;
  return {
    series: useRemote ? remote!.points : local,
    source: (useRemote ? "backend" : "local") as PayoffSource,
    loading,
    fellBack: failed,
  };
}
