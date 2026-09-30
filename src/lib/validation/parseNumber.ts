// Strict, locale-aware decimal parsing for user input. Never guesses:
// anything that isn't unambiguously a plain decimal number is rejected with
// a reason, instead of being coerced (`parseFloat("1O") === 1`).
//
// Accepted (en-US shown; separators follow the locale):
//   "12"  "12.5"  ".5"  "12."  "1,234.5"  "-3" (if allowed)  "+3"  " 12 "
// Rejected:
//   "1O" "1e3" "0x10" "Infinity" "NaN" "1.2.3" "1,23.4" "--1" "１２" "" …

export type ParseError =
  | "required"
  | "invalid"
  | "scientific"
  | "hex"
  | "negative"
  | "wrong_separator"
  | "ambiguous_separator"
  | "too_long";

export interface ParsedDecimal {
  /** Canonical form: optional "-", integer digits without leading zeros, optional "." fraction. */
  canonical: string;
  negative: boolean;
  intPart: string;
  fracPart: string;
}

export type ParseResult = { ok: true; value: ParsedDecimal } | { ok: false; error: ParseError };

export interface LocaleSeparators {
  decimal: string;
  group: string;
}

const separatorCache = new Map<string, LocaleSeparators>();

/** Decimal and grouping characters for a locale (e.g. de-DE → "," and "."). */
export function localeSeparators(locale?: string): LocaleSeparators {
  const key = locale ?? "";
  const cached = separatorCache.get(key);
  if (cached) return cached;
  let decimal = ".";
  let group = ",";
  try {
    const fmt = new Intl.NumberFormat(locale);
    decimal = fmt.formatToParts(1.5).find((p) => p.type === "decimal")?.value ?? ".";
    group = fmt.formatToParts(1_000_000).find((p) => p.type === "group")?.value ?? ",";
  } catch {
    // Invalid locale tag → default en-style separators.
  }
  const result = { decimal, group: /\s/.test(group) || group === " " ? " " : group };
  separatorCache.set(key, result);
  return result;
}

const MAX_INPUT_LENGTH = 64;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface ParseOptions {
  locale?: string;
  allowNegative?: boolean;
}

export function parseDecimal(raw: string, { locale, allowNegative = false }: ParseOptions = {}): ParseResult {
  // Normalise whitespace (incl. NBSP / narrow NBSP from pastes) and the Unicode minus sign.
  let s = raw.replace(/[   ]/g, " ").replace(/[​-‍﻿]/g, "").replace(/−/g, "-").trim();
  if (s === "") return { ok: false, error: "required" };
  if (s.length > MAX_INPUT_LENGTH) return { ok: false, error: "too_long" };
  if (/^[+-]?0[xob]/i.test(s)) return { ok: false, error: "hex" };
  if (/^[+-]?[\d.,\s]*\d[eE][+-]?\d/.test(s)) return { ok: false, error: "scientific" };

  let negative = false;
  if (s[0] === "-" || s[0] === "+") {
    negative = s[0] === "-";
    s = s.slice(1);
  }
  if (negative && !allowNegative) return { ok: false, error: "negative" };
  if (!/^[0-9.,\s]+$/.test(s)) return { ok: false, error: "invalid" };

  const { decimal: D, group: G } = localeSeparators(locale);
  const d = escapeRe(D);
  const g = G === " " ? " " : escapeRe(G);

  let intPart: string;
  let fracPart = "";
  let m: RegExpMatchArray | null;

  if ((m = s.match(new RegExp(`^(\\d*)(?:${d}(\\d*))?$`))) && (m[1] !== "" || (m[2] ?? "") !== "")) {
    // Plain: "12", "12.5", ".5", "12."
    intPart = m[1] || "0";
    fracPart = m[2] ?? "";
  } else if ((m = s.match(new RegExp(`^(\\d{1,3}(?:${g}\\d{3})+)(?:${d}(\\d*))?$`)))) {
    // Correctly grouped: "1,234,567.5"
    intPart = m[1].split(G).join("");
    fracPart = m[2] ?? "";
  } else {
    // The "other" separator used as a decimal point — accept only when it
    // can't be a grouping separator in this locale and appears once.
    const alt = D === "." ? "," : ".";
    const altCount = s.split(alt).length - 1;
    if (alt !== G && altCount === 1 && !s.includes(D) && !s.includes(" ")) {
      const [i, f] = s.split(alt);
      if (/^\d*$/.test(i) && /^\d*$/.test(f) && (i + f).length > 0) {
        intPart = i || "0";
        fracPart = f;
      } else return { ok: false, error: "invalid" };
    } else if (alt === G && altCount === 1 && !s.includes(D)) {
      // e.g. "1,5" in en-US or "1.5" in de-DE: bad grouping and not our decimal.
      return { ok: false, error: /^\d+[.,]\d{3}$/.test(s) ? "ambiguous_separator" : "wrong_separator" };
    } else {
      return { ok: false, error: "invalid" };
    }
  }

  intPart = intPart.replace(/^0+(?=\d)/, "");
  fracPart = fracPart.replace(/0+$/, "");
  const isZero = /^0*$/.test(intPart) && fracPart === "";
  if (isZero) negative = false; // -0 → 0
  const canonical = `${negative ? "-" : ""}${intPart}${fracPart ? `.${fracPart}` : ""}`;
  return { ok: true, value: { canonical, negative, intPart, fracPart } };
}

/** Number of fractional digits in a canonical decimal string. */
export function fractionDigits(p: ParsedDecimal): number {
  return p.fracPart.length;
}

/**
 * Exact conversion to integer base units (e.g. 7 decimals for Stellar
 * stroops) using bigint — safe beyond Number.MAX_SAFE_INTEGER for i128.
 * Returns null if the value has more fractional digits than `decimals`.
 */
export function toBaseUnits(p: ParsedDecimal, decimals: number): bigint | null {
  if (p.fracPart.length > decimals) return null;
  const units = BigInt(p.intPart + p.fracPart.padEnd(decimals, "0"));
  return p.negative ? -units : units;
}

/** Inverse of toBaseUnits, for display. */
export function fromBaseUnits(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = (negative ? -units : units).toString().padStart(decimals + 1, "0");
  const int = abs.slice(0, abs.length - decimals);
  const frac = abs.slice(abs.length - decimals).replace(/0+$/, "");
  return `${negative ? "-" : ""}${int}${frac ? `.${frac}` : ""}`;
}

/** Format a number for editing in the user's locale (no grouping). */
export function formatForInput(n: number, locale?: string, maxFractionDigits = 7): string {
  if (!Number.isFinite(n)) return "";
  const { decimal } = localeSeparators(locale);
  const fixed = Number(n.toFixed(maxFractionDigits)).toString();
  // toString can produce exponent form for tiny / huge values; fall back to toFixed.
  const plain = /e/i.test(fixed) ? n.toFixed(maxFractionDigits).replace(/\.?0+$/, "") : fixed;
  return plain.replace(".", decimal);
}
