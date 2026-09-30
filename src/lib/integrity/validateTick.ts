/**
 * validateTick — pure, side-effect-free validation pipeline for spot/vol ticks.
 *
 * Design principles:
 * - Pure function: same inputs → same output; no global state read or written.
 * - Each check is a named, independently-testable rule.
 * - Returns {accept: true} or {accept: false, reason, field, value} so callers
 *   can log, count, and display the exact failure without re-running the checks.
 *
 * Terminology:
 *  - "tick"   : one {prices, vols} payload received from the WS feed.
 *  - "symbol" : e.g. "BTC", "ETH" — a key in prices / vols.
 *  - "baseline": rolling median over the last N accepted prices, kept by the
 *    caller (integrityStore). validateTick is stateless; it only receives the
 *    current baseline as a parameter.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RawTick {
  prices: Record<string, number>;
  vols: Record<string, number>;
}

/** Per-symbol baseline fed in from the store. */
export interface SymbolBaseline {
  /** Rolling median of recent accepted prices (undefined = no history yet). */
  medianPrice?: number;
  /** Timestamp (ms) of the last accepted tick for this symbol. */
  lastAcceptedAt?: number;
  /** Whether the feed just reconnected (reset the jump check on first tick). */
  reconnected?: boolean;
}

export interface ValidationConfig {
  /**
   * Maximum fractional price change vs rolling median to accept in one tick.
   * Default: 0.15 (15%). Set higher for assets with known flash-crash
   * behaviour; set lower for stablecoins.
   */
  maxJumpFraction?: number;

  /**
   * After a reconnect (or on the very first tick), how many consecutive
   * accepts to require before re-enabling the jump-check.
   * Default: 1 (i.e. the first tick after reconnect is always accepted and
   * sets the new baseline, but the second tick is already guarded).
   */
  reconnectGraceTicks?: number;

  /** Hard floor: any price at or below this is rejected. Default: 0. */
  minPrice?: number;

  /** Hard ceiling: any price at or above this is rejected. Default: Infinity. */
  maxPrice?: number;

  /** Minimum valid implied vol (decimal). Default: 0.001 (0.1%). */
  minVol?: number;

  /** Maximum valid implied vol (decimal). Default: 20.0 (2000%). */
  maxVol?: number;

  /**
   * Maximum deviation (fraction) between the spot price for a symbol and
   * the corresponding oracle price, when an oracle is provided.
   * Default: 0.10 (10%).
   */
  maxOracleDeviation?: number;
}

export type RejectReason =
  | "non_finite_price"
  | "non_positive_price"
  | "price_below_floor"
  | "price_above_ceiling"
  | "non_finite_vol"
  | "non_positive_vol"
  | "vol_out_of_range"
  | "price_jump_too_large"
  | "oracle_deviation_too_large";

export interface AcceptResult {
  accept: true;
}

export interface RejectResult {
  accept: false;
  reason: RejectReason;
  symbol: string;
  /** Human-readable description for the banner / logs. */
  message: string;
  /** The offending value. */
  value: number;
}

export type ValidationResult = AcceptResult | RejectResult;

// ─── Defaults ────────────────────────────────────────────────────────────────

const DEFAULTS: Required<ValidationConfig> = {
  maxJumpFraction: 0.15,
  reconnectGraceTicks: 1,
  minPrice: 0,
  maxPrice: Infinity,
  minVol: 0.001,
  maxVol: 20.0,
  maxOracleDeviation: 0.10,
};

// ─── Internal helpers ────────────────────────────────────────────────────────

function reject(reason: RejectReason, symbol: string, value: number): RejectResult {
  const msgs: Record<RejectReason, string> = {
    non_finite_price: `Price for ${symbol} is not a finite number (got ${value})`,
    non_positive_price: `Price for ${symbol} is not positive (got ${value})`,
    price_below_floor: `Price for ${symbol} is below configured floor (got ${value})`,
    price_above_ceiling: `Price for ${symbol} is above configured ceiling (got ${value})`,
    non_finite_vol: `Vol for ${symbol} is not a finite number (got ${value})`,
    non_positive_vol: `Vol for ${symbol} is not positive (got ${value})`,
    vol_out_of_range: `Vol for ${symbol} is outside valid range (got ${value})`,
    price_jump_too_large: `Price jump for ${symbol} is too large vs recent median (got ${value})`,
    oracle_deviation_too_large: `Price for ${symbol} deviates too far from oracle (got ${value})`,
  };
  return { accept: false, reason, symbol, message: msgs[reason], value };
}

// ─── Individual rule functions (exported for unit-testing in isolation) ───────

/** Rule 1 — price must be a finite, positive number. */
export function checkPriceFinitePositive(
  symbol: string,
  price: number,
): RejectResult | null {
  if (!Number.isFinite(price)) return reject("non_finite_price", symbol, price);
  if (price <= 0) return reject("non_positive_price", symbol, price);
  return null;
}

/** Rule 2 — price must lie inside configured hard bounds. */
export function checkPriceBounds(
  symbol: string,
  price: number,
  cfg: Required<ValidationConfig>,
): RejectResult | null {
  if (price <= cfg.minPrice) return reject("price_below_floor", symbol, price);
  if (price >= cfg.maxPrice) return reject("price_above_ceiling", symbol, price);
  return null;
}

/** Rule 3 — vol must be a finite, positive number inside the valid range. */
export function checkVol(
  symbol: string,
  vol: number,
  cfg: Required<ValidationConfig>,
): RejectResult | null {
  if (!Number.isFinite(vol)) return reject("non_finite_vol", symbol, vol);
  if (vol <= 0) return reject("non_positive_vol", symbol, vol);
  if (vol < cfg.minVol || vol > cfg.maxVol)
    return reject("vol_out_of_range", symbol, vol);
  return null;
}

/**
 * Rule 4 — per-symbol price jump check vs rolling median.
 *
 * Skipped on the very first tick (no median yet) and on the first tick after a
 * reconnect (the reconnect flag is cleared by the store after one accepted
 * tick so subsequent ticks are guarded again).
 */
export function checkPriceJump(
  symbol: string,
  price: number,
  baseline: SymbolBaseline | undefined,
  cfg: Required<ValidationConfig>,
): RejectResult | null {
  const median = baseline?.medianPrice;
  if (median === undefined) return null; // no history → accept and seed the baseline
  if (baseline?.reconnected) return null; // first tick after reconnect → always accept

  const deviation = Math.abs(price - median) / median;
  if (deviation > cfg.maxJumpFraction)
    return reject("price_jump_too_large", symbol, price);
  return null;
}

/**
 * Rule 5 — cross-check against oracle price where provided.
 *
 * `oraclePrices` is optional; if the oracle map is absent or doesn't include
 * the symbol, the check is skipped (oracle is a best-effort guard, not a hard
 * requirement).
 */
export function checkOracleDeviation(
  symbol: string,
  price: number,
  oraclePrices: Record<string, number> | undefined,
  cfg: Required<ValidationConfig>,
): RejectResult | null {
  if (!oraclePrices) return null;
  const oracle = oraclePrices[symbol];
  if (oracle === undefined || !Number.isFinite(oracle) || oracle <= 0) return null;

  const deviation = Math.abs(price - oracle) / oracle;
  if (deviation > cfg.maxOracleDeviation)
    return reject("oracle_deviation_too_large", symbol, price);
  return null;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Validates a single tick for all symbols present in `tick.prices`.
 *
 * Returns the first rule failure found (fail-fast), or {accept: true} if all
 * symbols pass every rule.
 *
 * @param tick         The raw tick to validate.
 * @param baselines    Per-symbol rolling state from integrityStore.
 * @param config       Configurable thresholds (merged with defaults).
 * @param oraclePrices Optional oracle snapshot for cross-checking (e.g. from
 *                     the oracle panel described in the related issue).
 */
export function validateTick(
  tick: RawTick,
  baselines: Record<string, SymbolBaseline>,
  config: ValidationConfig = {},
  oraclePrices?: Record<string, number>,
): ValidationResult {
  const cfg: Required<ValidationConfig> = { ...DEFAULTS, ...config };
  const symbols = Object.keys(tick.prices);

  for (const sym of symbols) {
    const price = tick.prices[sym];
    const vol = tick.vols[sym];
    const baseline = baselines[sym];

    // — Price checks —
    const r1 = checkPriceFinitePositive(sym, price);
    if (r1) return r1;

    const r2 = checkPriceBounds(sym, price, cfg);
    if (r2) return r2;

    const r3 = checkPriceJump(sym, price, baseline, cfg);
    if (r3) return r3;

    const r4 = checkOracleDeviation(sym, price, oraclePrices, cfg);
    if (r4) return r4;

    // — Vol checks (vol is optional per-symbol in the schema) —
    if (vol !== undefined) {
      const r5 = checkVol(sym, vol, cfg);
      if (r5) return r5;
    }
  }

  return { accept: true };
}

// ─── Utility: rolling median helper (used by integrityStore) ─────────────────

/**
 * Returns the median of `window` (non-mutating). Works for any odd or even N.
 * Exported so the store can keep its own rolling buffer and call this when a
 * tick is accepted.
 */
export function rollingMedian(window: number[]): number {
  if (window.length === 0) return NaN;
  const sorted = [...window].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}
