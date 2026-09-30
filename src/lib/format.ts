/**
 * Instrument-aware formatting. Pure module (no React) with cached
 * Intl.NumberFormat instances. Locale-ready: every formatter takes an
 * optional locale, defaulting to en-US.
 *
 * Non-finite rendering (documented, tested by design):
 *   NaN        -> "—"   (never the string "NaN")
 *   +Infinity  -> "∞"
 *   -Infinity  -> "-∞"
 *   0 / -0     -> a real zero ("0.00"), never "—"; negative zero never shows a minus sign.
 *
 * Never format-then-parse: strikes sent to the backend are rounded with
 * `roundToTick`, not by parsing formatted text.
 */

export interface Instrument {
  sym: string;
  displayName: string;
  tickSize: number;
  pricePrecision: number;
  quantityStep: number;
}

export const INSTRUMENTS: Record<string, Instrument> = {
  XLM: { sym: "XLM", displayName: "XLM-USD", tickSize: 0.0001, pricePrecision: 4, quantityStep: 1 },
  BTC: { sym: "BTC", displayName: "BTC-USD", tickSize: 0.01, pricePrecision: 2, quantityStep: 1 },
  ETH: { sym: "ETH", displayName: "ETH-USD", tickSize: 0.01, pricePrecision: 2, quantityStep: 1 },
  SOL: { sym: "SOL", displayName: "SOL-USD", tickSize: 0.01, pricePrecision: 2, quantityStep: 1 },
};

const FALLBACK: Instrument = { sym: "?", displayName: "?", tickSize: 0.0001, pricePrecision: 4, quantityStep: 1 };

export function getInstrument(sym: string | undefined | null): Instrument {
  return (sym && INSTRUMENTS[sym]) || FALLBACK;
}

export function roundToTick(sym: string, n: number): number {
  const t = getInstrument(sym).tickSize;
  return Math.round(n / t) * t;
}

const DEFAULT_LOCALE = "en-US";
const cache = new Map<string, Intl.NumberFormat>();
function nf(locale: string, key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const k = `${locale}|${key}`;
  let f = cache.get(k);
  if (!f) {
    f = new Intl.NumberFormat(locale, opts);
    cache.set(k, f);
  }
  return f;
}

const NAN_TEXT = "—";
const nonFinite = (n: number): string | null =>
  Number.isNaN(n) ? NAN_TEXT : n === Infinity ? "∞" : n === -Infinity ? "-∞" : null;

/** Collapses -0 and values that round to zero so no "-0.00" is ever shown. */
function fixed(n: number, minDp: number, maxDp: number, locale: string, extra: Intl.NumberFormatOptions = {}): string {
  const f = nf(locale, `f${minDp}-${maxDp}-${JSON.stringify(extra)}`, {
    minimumFractionDigits: minDp,
    maximumFractionDigits: maxDp,
    ...extra,
  });
  const s = f.format(n);
  return /^-?[0.,\s]*$/.test(s) ? f.format(0) : s;
}

export function formatNumber(n: number, dp = 4, locale = DEFAULT_LOCALE): string {
  return nonFinite(n) ?? fixed(n, dp, dp, locale);
}

/** Price in quote currency using the instrument's precision, with $ prefix. */
export function formatPrice(sym: string, n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  const p = getInstrument(sym).pricePrecision;
  return fixed(n, p, p, locale, { style: "currency", currency: "USD" });
}

/** Same as formatPrice without the currency symbol (strikes, axis labels). */
export function formatStrike(sym: string, n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  const p = getInstrument(sym).pricePrecision;
  return fixed(n, p, p, locale);
}

/** Option premium: at least the instrument precision, up to 4dp for sub-tick premiums. */
export function formatPremium(sym: string, n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  const p = Math.max(getInstrument(sym).pricePrecision, 4);
  return fixed(n, p, p, locale);
}

export interface PnlText {
  text: string;
  /** CSS var-based class hook: "pnl-pos" | "pnl-neg" | "pnl-flat" */
  className: "pnl-pos" | "pnl-neg" | "pnl-flat";
}

/** Signed P&L ("+$1.20" / "-$0.50" / "$0.00"). */
export function formatPnl(n: number, dp = 2, locale = DEFAULT_LOCALE): PnlText {
  const nfv = nonFinite(n);
  if (nfv) return { text: nfv, className: "pnl-flat" };
  const abs = fixed(Math.abs(n), dp, dp, locale);
  const isZero = Number(abs.replace(/[^0-9.]/g, "")) === 0;
  if (isZero) return { text: `$${abs}`, className: "pnl-flat" };
  return n > 0
    ? { text: `+$${abs}`, className: "pnl-pos" }
    : { text: `-$${abs}`, className: "pnl-neg" };
}

export type GreekKind = "delta" | "gamma" | "theta" | "vega" | "iv" | "rho";
const GREEK_DP: Record<GreekKind, number> = { delta: 3, gamma: 5, theta: 4, vega: 4, rho: 4, iv: 1 };

export function formatGreek(kind: GreekKind, n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  if (kind === "iv") return fixed(n * 100, 1, 1, locale) + "%";
  const dp = GREEK_DP[kind];
  return fixed(n, dp, dp, locale);
}

/** Ratio (0.1234) as a percentage string. */
export function formatPct(ratio: number, dp = 1, locale = DEFAULT_LOCALE): string {
  return nonFinite(ratio) ?? fixed(ratio * 100, dp, dp, locale) + "%";
}

export function formatCompact(n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  return nf(locale, "compact", { notation: "compact", maximumFractionDigits: 2 }).format(n === 0 ? 0 : n);
}

export function formatQuantity(sym: string, n: number, locale = DEFAULT_LOCALE): string {
  const nfv = nonFinite(n);
  if (nfv) return nfv;
  const step = getInstrument(sym).quantityStep;
  const dp = step >= 1 ? 0 : Math.min(8, Math.ceil(-Math.log10(step)));
  return fixed(n, dp, dp, locale);
}

/** Hook seam for a future locale context; today returns bound default-locale formatters. */
export function useFormatters(locale: string = DEFAULT_LOCALE) {
  return {
    price: (s: string, n: number) => formatPrice(s, n, locale),
    strike: (s: string, n: number) => formatStrike(s, n, locale),
    premium: (s: string, n: number) => formatPremium(s, n, locale),
    pnl: (n: number, dp?: number) => formatPnl(n, dp, locale),
    greek: (k: GreekKind, n: number) => formatGreek(k, n, locale),
    pct: (n: number, dp?: number) => formatPct(n, dp, locale),
    compact: (n: number) => formatCompact(n, locale),
    quantity: (s: string, n: number) => formatQuantity(s, n, locale),
  };
}
