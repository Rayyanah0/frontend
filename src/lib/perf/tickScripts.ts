/**
 * Deterministic tick generators for the four hot-path scenarios.
 *
 * Each generator returns an array of "tick payloads" that the harness
 * pumps into the component under test at a controlled cadence. Using
 * seeded pseudo-random values means every run produces the same data,
 * making regression comparisons valid across machines.
 *
 * Scenarios:
 *  1. spot-tick      — 60 WebSocket spot price updates
 *  2. chain-update   — 20 full chain repaints (21 strikes × 2 options each)
 *  3. position-mtm   — 30 position mark-to-market updates (10 positions)
 *  4. tab-switch     — 8 tab switches cycling through Chain/Positions/Strategies/Surface
 */

import type { ChainRowData } from "../chainRows";

/** Shape the SpotFeedContext provider receives from the websocket. */
export interface SpotTickPayload {
  /** Map of symbol → price, matches SpotResponseSchema `prices` field */
  prices: Record<string, number>;
  /** Map of symbol → implied vol, matches SpotResponseSchema `vols` field */
  vols: Record<string, number>;
}

// ─── Seeded PRNG (xorshift32) ─────────────────────────────────────────────────
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

// ─── Spot tick ────────────────────────────────────────────────────────────────
export function generateSpotTicks(
  symbols: string[] = ["BTC", "ETH"],
  count = 60,
  basePrices: Record<string, number> = { BTC: 65_000, ETH: 3_200 },
  seed = 0xdeadbeef,
): SpotTickPayload[] {
  const rng = makeRng(seed);
  const prices = { ...basePrices };
  const vols: Record<string, number> = Object.fromEntries(symbols.map((s) => [s, 0.65]));

  return Array.from({ length: count }, () => {
    const nextPrices: Record<string, number> = {};
    const nextVols: Record<string, number> = {};
    for (const sym of symbols) {
      prices[sym] = prices[sym] * (1 + (rng() - 0.5) * 0.002);
      nextPrices[sym] = Math.round(prices[sym] * 100) / 100;
      vols[sym] = Math.max(0.1, vols[sym] + (rng() - 0.5) * 0.01);
      nextVols[sym] = Math.round(vols[sym] * 10000) / 10000;
    }
    return { prices: nextPrices, vols: nextVols };
  });
}

// ─── Chain update ─────────────────────────────────────────────────────────────
export function generateChainUpdates(
  count = 20,
  baseSpot = 65_000,
  seed = 0xcafe1234,
): ChainRowData[][] {
  const rng = makeRng(seed);
  let spot = baseSpot;
  return Array.from({ length: count }, () => {
    spot = spot * (1 + (rng() - 0.5) * 0.004);
    return Array.from({ length: 21 }, (_, i) => {
      const n = i - 10;
      const strike = Math.round(spot * (1 + n * 0.04) * 100) / 100;
      const iv = 0.6 + rng() * 0.2;
      const t = 30 / 365;
      const callPremium =
        Math.max(0, (spot - strike) * 0.5 + spot * iv * Math.sqrt(t) * 0.4) * (0.98 + rng() * 0.04);
      const putPremium =
        Math.max(0, (strike - spot) * 0.5 + spot * iv * Math.sqrt(t) * 0.4) * (0.98 + rng() * 0.04);
      return {
        strike,
        call: {
          premium: callPremium,
          delta: Math.min(0.99, Math.max(0.01, 0.5 + (spot - strike) / (spot * 0.1))),
          gamma: 0.001 + rng() * 0.005,
          theta: -(0.01 + rng() * 0.02),
          vega: 0.1 + rng() * 0.2,
          iv,
        },
        put: {
          premium: putPremium,
          delta: -Math.min(0.99, Math.max(0.01, 0.5 + (strike - spot) / (spot * 0.1))),
          gamma: 0.001 + rng() * 0.005,
          theta: -(0.01 + rng() * 0.02),
          vega: 0.1 + rng() * 0.2,
          iv: iv + 0.02,
        },
        itmCall: spot > strike,
        itmPut: spot < strike,
      } satisfies ChainRowData;
    });
  });
}

// ─── Position MTM update ──────────────────────────────────────────────────────
export interface PositionMtmTick {
  id: string;
  symbol: string;
  strike: number;
  expiry: string;
  type: "call" | "put";
  side: "long" | "short";
  contracts: number;
  premium: number;
  currentPrice: number;
  unrealizedPnl: number;
}

export function generatePositionMtmTicks(
  positionCount = 10,
  tickCount = 30,
  seed = 0x1a2b3c4d,
): PositionMtmTick[][] {
  const rng = makeRng(seed);

  // Build a fixed set of positions (stable identity across ticks)
  const positions: Omit<PositionMtmTick, "currentPrice" | "unrealizedPnl">[] = Array.from(
    { length: positionCount },
    (_, i) => ({
      id: `pos-${i}`,
      symbol: i % 2 === 0 ? "BTC" : "ETH",
      strike: i % 2 === 0 ? 60000 + i * 2000 : 2800 + i * 100,
      expiry: "2025-03-28",
      type: (i % 2 === 0 ? "call" : "put") as "call" | "put",
      side: (rng() > 0.5 ? "long" : "short") as "long" | "short",
      contracts: Math.ceil(rng() * 5),
      premium: 200 + rng() * 800,
    }),
  );

  return Array.from({ length: tickCount }, () =>
    positions.map((pos) => {
      const currentPrice = pos.premium * (0.8 + rng() * 0.4);
      const mult = pos.side === "long" ? 1 : -1;
      const unrealizedPnl = mult * (currentPrice - pos.premium) * pos.contracts;
      return { ...pos, currentPrice, unrealizedPnl };
    }),
  );
}

// ─── Tab switch ───────────────────────────────────────────────────────────────
export type TabName = "chain" | "positions" | "strategies" | "surface";

export function generateTabSwitches(count = 8): TabName[] {
  const tabs: TabName[] = ["chain", "positions", "strategies", "surface"];
  return Array.from({ length: count }, (_, i) => tabs[(i + 1) % tabs.length]);
}
