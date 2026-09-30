/**
 * Volatility context computations: IV rank/percentile and realized-vol cone.
 *
 * All functions are pure and synchronous — no I/O, no side effects.
 * They operate on arrays of daily OHLC/close-price samples, which callers
 * source from the mock adapter (feature-flagged) or the real backend.
 */

// ---------------------------------------------------------------------------
// IV Rank & Percentile
// ---------------------------------------------------------------------------

/**
 * IV Rank: where the current IV sits within its 52-week range.
 *
 *   IVR = (currentIV - low52w) / (high52w - low52w) × 100
 *
 * Returns a value in [0, 100] where 0 = at the 52-week low and 100 = at
 * the 52-week high. Returns null if the window is degenerate (empty or
 * high === low).
 *
 * @param currentIV   The current ATM implied volatility (e.g. 0.65 for 65%).
 * @param ivHistory   Array of daily ATM IV values, most-recent last.
 *                    Should contain roughly 252 entries for a 52-week window.
 */
export function ivRank(currentIV: number, ivHistory: number[]): number | null {
  if (ivHistory.length === 0) return null;
  const high = Math.max(...ivHistory);
  const low = Math.min(...ivHistory);
  if (high === low) return null;
  return ((currentIV - low) / (high - low)) * 100;
}

/**
 * IV Percentile: the fraction of past days on which IV was below the
 * current IV, expressed as a percentage.
 *
 *   IVP = count(ivHistory[i] < currentIV) / len(ivHistory) × 100
 *
 * Returns a value in [0, 100] where 0 = cheapest-ever and 100 = priciest-ever.
 * Returns null for an empty history array.
 *
 * IV Percentile is generally preferred over IV Rank by practitioners
 * because it is robust to outliers: a single spike to an extreme value
 * doesn't compress the entire scale the way it does with IVR.
 *
 * @param currentIV  The current ATM implied volatility.
 * @param ivHistory  Array of daily ATM IV values (any order).
 */
export function ivPercentile(currentIV: number, ivHistory: number[]): number | null {
  if (ivHistory.length === 0) return null;
  const below = ivHistory.filter(v => v < currentIV).length;
  return (below / ivHistory.length) * 100;
}

// ---------------------------------------------------------------------------
// Realized-Volatility Cone
// ---------------------------------------------------------------------------

/**
 * Close-to-close realized volatility over a rolling window of `days` calendar
 * days, computed from daily log-returns.
 *
 *   σ_realized = std(log(P_t / P_{t-1})) × √252   (annualized)
 *
 * Returns null if there are fewer data points than the requested window.
 *
 * @param closes  Array of daily close prices, oldest first.
 * @param days    Rolling window length in trading days (e.g. 10, 30, 60, 90).
 */
export function realizedVol(closes: number[], days: number): number | null {
  // Need at least `days + 1` closes to form `days` log-returns
  if (closes.length < days + 1) return null;
  const window = closes.slice(-(days + 1));
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    returns.push(Math.log(window[i] / window[i - 1]));
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance * 252);
}

/** One point on the realized-vol cone: the current, min, max, and median RV
 *  computed from all rolling windows of the given length within the price
 *  history. */
export interface VolConePoint {
  days: number;
  /** Most recent rolling-window RV (rightmost window in the series). */
  current: number | null;
  /** Minimum RV across all rolling windows of this length in the history. */
  min: number | null;
  /** 25th-percentile RV (bottom of the "normal" band). */
  p25: number | null;
  /** Median RV across all rolling windows of this length in the history. */
  median: number | null;
  /** 75th-percentile RV (top of the "normal" band). */
  p75: number | null;
  /** Maximum RV across all rolling windows of this length in the history. */
  max: number | null;
}

/**
 * Build a realized-volatility cone from a price history.
 *
 * For each `windowDays` value, all non-overlapping rolling-window RV
 * estimates are computed from the full history, then summarised into
 * min/p25/median/p75/max. The `current` field is the most recent
 * (rightmost) single window.
 *
 * @param closes      Array of daily close prices, oldest first.
 *                    A 2-year history (~504 days) is recommended.
 * @param windowDays  Array of window sizes to compute (e.g. [10, 30, 60, 90]).
 */
export function realizedVolCone(
  closes: number[],
  windowDays: number[] = [10, 30, 60, 90]
): VolConePoint[] {
  return windowDays.map(days => {
    if (closes.length < days + 1) {
      return { days, current: null, min: null, p25: null, median: null, p75: null, max: null };
    }

    // Slide a window of `days` log-returns across the full history.
    // Step by 1 day (overlapping windows) for better statistical coverage.
    const estimates: number[] = [];
    for (let start = 0; start + days < closes.length; start++) {
      const rv = realizedVol(closes.slice(start, start + days + 1), days);
      if (rv !== null) estimates.push(rv);
    }
    if (estimates.length === 0) {
      return { days, current: null, min: null, p25: null, median: null, p75: null, max: null };
    }
    estimates.sort((a, b) => a - b);
    const n = estimates.length;
    const current = realizedVol(closes.slice(-(days + 1)), days);

    const pct = (p: number) => estimates[Math.min(Math.floor((p / 100) * n), n - 1)];

    return {
      days,
      current,
      min: estimates[0],
      p25: pct(25),
      median: pct(50),
      p75: pct(75),
      max: estimates[n - 1],
    };
  });
}

// ---------------------------------------------------------------------------
// IV vs RV spread (richness/cheapness indicator)
// ---------------------------------------------------------------------------

/**
 * IV premium over realized vol for each term. Positive = options are "rich"
 * (IV > RV → theta-sellers are being paid above historical average).
 * Negative = options are "cheap".
 *
 * @param conePoints  Output of `realizedVolCone`.
 * @param atmIv       A function mapping window-days to the corresponding term ATM IV.
 *                    Callers can interpolate a term-structure or just pass the spot IV.
 */
export function ivRvSpread(
  conePoints: VolConePoint[],
  atmIv: (days: number) => number
): Array<{ days: number; iv: number; rv: number | null; spread: number | null }> {
  return conePoints.map(pt => {
    const iv = atmIv(pt.days);
    const rv = pt.current;
    return {
      days: pt.days,
      iv,
      rv,
      spread: rv !== null ? iv - rv : null,
    };
  });
}
