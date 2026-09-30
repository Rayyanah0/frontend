"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { getPrice } from "../api/market";
import type { StrategyTemplate } from "../strategies";
import type { PricedLeg } from "../payoff";
import type { ChainRowData } from "../chainRows";
import { netPremium } from "../payoff";
import type { Greeks } from "../pricing";

export type QuoteSource = "chain" | "backend" | "local";

export const QUOTE_STALE_MS = 10_000;
const DEBOUNCE_MS = 250;

/** Nearest listed strike to `target` (chain must be non-empty). */
export function snapStrike(chain: ChainRowData[], target: number): ChainRowData {
  return chain.reduce((best, r) => (Math.abs(r.strike - target) < Math.abs(best.strike - target) ? r : best), chain[0]);
}

/** Relative move of `next` vs `prev` net premium (|Δ| / max(|prev|, eps)). */
export function quoteMove(prev: number, next: number): number {
  return Math.abs(next - prev) / Math.max(Math.abs(prev), 1e-9);
}

interface Args {
  template: StrategyTemplate | null;
  sym: string;
  expiryDays: number;
  qty: number;
  spot: number;
  /** Current chain snapshot; only used when `chainIsLive` (i.e. it came from the backend). */
  chain: ChainRowData[];
  chainIsLive: boolean;
  /** Local Black-Scholes pricing of the same legs: offline fallback. */
  localLegs: PricedLeg[];
}

/**
 * Backend-priced strategy quote. Each leg's strike is snapped to the nearest
 * listed chain strike and priced from the chain snapshot when it is live;
 * otherwise each leg is priced in parallel via /api/v1/price (debounced).
 * If any leg fails the whole quote falls back to local Black-Scholes and is
 * labelled `local` — a partial net premium is never presented as complete.
 * Re-quotes on template/expiry/qty change and automatically once older than 10s.
 */
export function useStrategyQuote({ template, sym, expiryDays, qty, spot, chain, chainIsLive, localLegs }: Args) {
  const [quote, setQuote] = useState<{ legs: PricedLeg[]; asOf: number; source: QuoteSource } | null>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  // Latest inputs read at quote time so spot/chain ticks don't trigger a re-quote by themselves.
  const latest = useRef({ spot, chain, chainIsLive, localLegs });
  latest.current = { spot, chain, chainIsLive, localLegs };
  const reqId = useRef(0);
  const asOfRef = useRef(0);

  useEffect(() => {
    const id = ++reqId.current;
    if (!template) { setQuote(null); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      const { spot: S, chain: rows, chainIsLive: live, localLegs: local } = latest.current;
      const finish = (legs: PricedLeg[], source: QuoteSource) => {
        if (id !== reqId.current) return;
        asOfRef.current = Date.now();
        setQuote({ legs, asOf: asOfRef.current, source });
        setLoading(false);
      };
      const targets = template.legs.map((l) => ({ leg: l, target: Math.round(S * l.strikeOffset * 10000) / 10000 }));
      if (live && rows.length > 0) {
        finish(targets.map(({ leg, target }) => {
          const row = snapStrike(rows, target);
          const g: Greeks = leg.side === "call" ? row.call : row.put;
          return { side: leg.side, action: leg.action, strike: row.strike, contracts: qty, greeks: g };
        }), "chain");
        return;
      }
      try {
        const legs = await Promise.all(targets.map(async ({ leg, target }) => {
          const r = await getPrice({ underlying: sym, strike: target, expiryDays, optionType: leg.side });
          return {
            side: leg.side, action: leg.action, strike: target, contracts: qty,
            greeks: { premium: r.premium, delta: r.delta, gamma: r.gamma, theta: r.theta, vega: r.vega, iv: r.iv },
          } as PricedLeg;
        }));
        finish(legs, "backend");
      } catch {
        finish(local, "local"); // any leg failing -> consistent local quote, never a partial one
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [template, sym, expiryDays, qty, tick]);

  // Auto re-quote once the displayed quote is stale.
  useEffect(() => {
    if (!template) return;
    const iv = setInterval(() => {
      if (asOfRef.current && Date.now() - asOfRef.current > QUOTE_STALE_MS) setTick((n) => n + 1);
    }, 2000);
    return () => clearInterval(iv);
  }, [template]);

  // Until the first quote lands, show the local calc (labelled local) rather than nothing.
  const legs = template ? quote?.legs ?? localLegs : [];
  const net = useMemo(() => netPremium(legs), [legs]);
  return {
    legs,
    netPremium: net,
    asOf: quote?.asOf ?? null,
    source: (quote?.source ?? "local") as QuoteSource,
    loading,
    requote: () => setTick((n) => n + 1),
  };
}
