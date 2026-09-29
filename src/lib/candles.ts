// Tick → OHLC candle aggregation, SMA/EMA, and realized volatility.
// Used by SpotPriceChart until GET /api/v1/candles is available.

export type CandleInterval = "1m" | "5m" | "1h" | "1D";

export interface Candle {
  /** Unix seconds (UTC bucket start). */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface Tick {
  t: number; // ms
  price: number;
}

const INTERVAL_MS: Record<CandleInterval, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "1h": 3_600_000,
  "1D": 86_400_000,
};

export function intervalMs(tf: CandleInterval): number {
  return INTERVAL_MS[tf];
}

/** Floor a timestamp (ms) to the start of its candle bucket (unix seconds). */
export function bucketStart(tMs: number, tf: CandleInterval): number {
  const ms = INTERVAL_MS[tf];
  return Math.floor(tMs / ms) * (ms / 1000);
}

/** Aggregate ticks into OHLC candles. Gaps are left empty (no synthetic fills). */
export function aggregateTicks(ticks: Tick[], tf: CandleInterval): Candle[] {
  if (ticks.length === 0) return [];
  const sorted = [...ticks].sort((a, b) => a.t - b.t);
  const map = new Map<number, Candle>();

  for (const tick of sorted) {
    if (!Number.isFinite(tick.price) || tick.price <= 0) continue;
    const time = bucketStart(tick.t, tf);
    const existing = map.get(time);
    if (!existing) {
      map.set(time, {
        time,
        open: tick.price,
        high: tick.price,
        low: tick.price,
        close: tick.price,
      });
    } else {
      existing.high = Math.max(existing.high, tick.price);
      existing.low = Math.min(existing.low, tick.price);
      existing.close = tick.price;
    }
  }

  return Array.from(map.values()).sort((a, b) => a.time - b.time);
}

/** Fold a live tick into the current (or new) candle. Returns a new array. */
export function updateCandleWithTick(
  candles: Candle[],
  tick: Tick,
  tf: CandleInterval
): Candle[] {
  if (!Number.isFinite(tick.price) || tick.price <= 0) return candles;
  const time = bucketStart(tick.t, tf);
  if (candles.length === 0) {
    return [{ time, open: tick.price, high: tick.price, low: tick.price, close: tick.price }];
  }
  const last = candles[candles.length - 1];
  if (time === last.time) {
    const next = {
      ...last,
      high: Math.max(last.high, tick.price),
      low: Math.min(last.low, tick.price),
      close: tick.price,
    };
    return [...candles.slice(0, -1), next];
  }
  if (time > last.time) {
    return [
      ...candles,
      { time, open: tick.price, high: tick.price, low: tick.price, close: tick.price },
    ];
  }
  // Out-of-order / late tick into an older bucket — ignore for live path.
  return candles;
}

export function computeSma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0) return out;
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function computeEma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (prev == null) {
      if (i >= period - 1) {
        let sum = 0;
        for (let j = i - period + 1; j <= i; j++) sum += values[j];
        prev = sum / period;
        out[i] = prev;
      }
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/**
 * Annualized realized volatility from close-to-close log returns
 * over a trailing `period` window. Annualization assumes `periodsPerYear`
 * (default: 365*24*60 for 1m crypto; callers should pass the right factor).
 */
export function realizedVol(
  closes: number[],
  period = 20,
  periodsPerYear = 365 * 24 * 60
): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (period < 2) return out;
  const logs: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const a = closes[i - 1];
    const b = closes[i];
    logs.push(a > 0 && b > 0 ? Math.log(b / a) : 0);
  }
  for (let i = period; i < closes.length; i++) {
    // logs index for close i is i-1; window of `period` returns ending at i-1
    const start = i - period;
    const end = i - 1;
    let sum = 0;
    let sumSq = 0;
    const n = end - start + 1;
    for (let j = start; j <= end; j++) {
      sum += logs[j];
      sumSq += logs[j] * logs[j];
    }
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);
    out[i] = Math.sqrt(variance * periodsPerYear);
  }
  return out;
}

export function periodsPerYearFor(tf: CandleInterval): number {
  switch (tf) {
    case "1m": return 365 * 24 * 60;
    case "5m": return 365 * 24 * 12;
    case "1h": return 365 * 24;
    case "1D": return 365;
  }
}
