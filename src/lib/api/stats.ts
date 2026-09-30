// Protocol analytics API — public /stats page data adapter.
// Defines the backend/indexer contract and ships MSW-compatible fixtures
// so the page works in development before the indexer is wired up.

import { apiGet } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export type StatRange = "24h" | "7d" | "30d" | "90d" | "all";

/** Single time-series data point used by all historical charts. */
export interface TimePoint {
  ts: number;   // Unix epoch ms
  value: number;
}

/** KPI tile — current value plus period deltas. */
export interface KpiMetric {
  value: number;
  change_24h: number;  // absolute
  change_24h_pct: number;
  change_7d: number;
  change_7d_pct: number;
}

/** Open interest split by call / put for a single underlying + expiry bucket. */
export interface OiBucket {
  underlying: string;
  expiry_days: number;
  call_oi: number;
  put_oi: number;
  total_oi: number;
  put_call_ratio: number;
}

/** Per-strike OI used for the max-pain chart. */
export interface StrikeOi {
  strike: number;
  call_oi: number;
  put_oi: number;
}

/** Max-pain calculation result per underlying + expiry. */
export interface MaxPainResult {
  underlying: string;
  expiry_days: number;
  max_pain_strike: number;
  strikes: StrikeOi[];
}

/** Top-level protocol stats snapshot. */
export interface ProtocolStats {
  tvl: KpiMetric;
  open_interest: KpiMetric;
  notional_volume_24h: KpiMetric;
  premium_volume_24h: KpiMetric;
  fees_24h: KpiMetric;
  fees_total: KpiMetric;
  active_traders_24h: KpiMetric;
  active_traders_7d: KpiMetric;
  put_call_ratio: KpiMetric;
  oi_by_bucket: OiBucket[];
  max_pain: MaxPainResult[];
  updated_at: string;
}

/** Historical series response for a single metric. */
export interface HistoricalSeries {
  metric: string;
  range: StatRange;
  points: TimePoint[];
}

// ── API calls ──────────────────────────────────────────────────────────────

/** Fetch the current protocol snapshot (public, no auth). */
export function getProtocolStats(): Promise<ProtocolStats> {
  return apiGet<ProtocolStats>("/stats");
}

/** Fetch historical time-series for a metric over a range. */
export function getStatHistory(
  metric: string,
  range: StatRange
): Promise<HistoricalSeries> {
  return apiGet<HistoricalSeries>(`/stats/history?metric=${metric}&range=${range}`);
}

/** JSON endpoint — returns the raw snapshot (same as getProtocolStats). */
export function getStatsJson(): Promise<ProtocolStats> {
  return apiGet<ProtocolStats>("/stats.json");
}

// ── MSW fixture data ───────────────────────────────────────────────────────
// Used in development / tests when the indexer is not available.
// Import and register with MSW in your test setup or dev worker.

function mockTimeSeries(days: number, base: number, volatility: number): TimePoint[] {
  const now = Date.now();
  const pts: TimePoint[] = [];
  let val = base;
  for (let i = days; i >= 0; i--) {
    val = Math.max(0, val + (Math.random() - 0.48) * volatility);
    pts.push({ ts: now - i * 86_400_000, value: Math.round(val * 100) / 100 });
  }
  return pts;
}

function mockKpi(value: number, dailySwing: number): KpiMetric {
  const d = (Math.random() - 0.45) * dailySwing;
  const w = d * 3.2 + (Math.random() - 0.5) * dailySwing * 2;
  return {
    value,
    change_24h: d,
    change_24h_pct: (d / value) * 100,
    change_7d: w,
    change_7d_pct: (w / value) * 100,
  };
}

const UNDERLYINGS = ["XLM", "BTC", "ETH", "SOL"];
const EXPIRIES = [7, 14, 30, 60, 90];

export const MOCK_STATS: ProtocolStats = {
  tvl: mockKpi(2_240_000, 45_000),
  open_interest: mockKpi(1_820_000, 38_000),
  notional_volume_24h: mockKpi(340_000, 22_000),
  premium_volume_24h: mockKpi(18_600, 1_400),
  fees_24h: mockKpi(930, 80),
  fees_total: mockKpi(142_000, 2_000),
  active_traders_24h: mockKpi(312, 18),
  active_traders_7d: mockKpi(891, 40),
  put_call_ratio: mockKpi(0.72, 0.04),
  oi_by_bucket: UNDERLYINGS.flatMap(u =>
    EXPIRIES.map(e => {
      const call = Math.round(Math.random() * 200_000 + 20_000);
      const put  = Math.round(Math.random() * 160_000 + 15_000);
      return {
        underlying: u, expiry_days: e,
        call_oi: call, put_oi: put,
        total_oi: call + put,
        put_call_ratio: +(put / call).toFixed(3),
      };
    })
  ),
  max_pain: UNDERLYINGS.map(u => {
    const base = u === "XLM" ? 0.12 : u === "BTC" ? 65000 : u === "ETH" ? 3400 : 150;
    const strikes = Array.from({ length: 9 }, (_, i) => {
      const K = +(base * (0.8 + i * 0.05)).toFixed(u === "XLM" ? 4 : 0);
      return {
        strike: K,
        call_oi: Math.round(Math.random() * 80_000 + 5_000),
        put_oi:  Math.round(Math.random() * 70_000 + 5_000),
      };
    });
    // Max pain: strike where total pain (ITM payout) is minimised
    const maxPainStrike = strikes.reduce((best, s) => {
      const pain = s.call_oi + s.put_oi;
      return pain < (best.call_oi + best.put_oi) ? s : best;
    }, strikes[4]).strike;
    return { underlying: u, expiry_days: 30, max_pain_strike: maxPainStrike, strikes };
  }),
  updated_at: new Date().toISOString(),
};

export const MOCK_HISTORIES: Record<string, TimePoint[]> = {
  tvl:                  mockTimeSeries(90, 2_000_000, 60_000),
  open_interest:        mockTimeSeries(90, 1_600_000, 50_000),
  notional_volume_24h:  mockTimeSeries(90, 300_000,   40_000),
  premium_volume_24h:   mockTimeSeries(90, 15_000,    2_000),
  fees_24h:             mockTimeSeries(90, 750,        150),
  active_traders_24h:   mockTimeSeries(90, 280,         30),
  put_call_ratio:       mockTimeSeries(90, 0.68,       0.08),
};
