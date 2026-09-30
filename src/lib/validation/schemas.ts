// Shared Zod schemas for every user input (forms and URL params). Each
// schema takes the RAW string the user typed and either produces a typed
// value or fails with a human-readable message — nothing is coerced
// silently. Use with useValidatedNumberInput() for inputs, or .safeParse()
// for URL params.
import { z } from "zod";
import { fractionDigits, localeSeparators, parseDecimal, toBaseUnits, type ParseError, type ParsedDecimal } from "./parseNumber";
import { checkStrKey, type StrKeyError } from "./strkey";

export interface LocaleOption {
  /** BCP-47 locale for decimal/group separators; defaults to the runtime locale. */
  locale?: string;
}

export function parseErrorMessage(error: ParseError, locale?: string): string {
  const { decimal } = localeSeparators(locale);
  switch (error) {
    case "required": return "Required";
    case "scientific": return "Scientific notation isn't allowed — type the full number";
    case "hex": return "Enter a decimal number";
    case "negative": return "Must not be negative";
    case "wrong_separator": return `Use "${decimal}" as the decimal separator`;
    case "ambiguous_separator": return `Ambiguous number — use "${decimal}" for decimals and no thousands separators`;
    case "too_long": return "Number is too long";
    default: return "Not a valid number";
  }
}

/** Raw string → ParsedDecimal (canonical form), with an issue on failure. */
function decimal(opts: LocaleOption & { allowNegative?: boolean } = {}) {
  return z.string().transform((raw, ctx): ParsedDecimal => {
    const r = parseDecimal(raw, opts);
    if (!r.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: parseErrorMessage(r.error, opts.locale), params: { reason: r.error } });
      return z.NEVER;
    }
    return r.value;
  });
}

const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 8 });

/** Count decimal places of a step like 0.01 → 2 (steps are code constants, not user input). */
function stepDecimals(step: number): number {
  const s = step.toString();
  if (/e-/i.test(s)) return Number(s.split(/e-/i)[1]);
  return s.includes(".") ? s.split(".")[1].length : 0;
}

/** Exact number conversion; rejects values that lose precision as a double. */
function toSafeNumber(p: ParsedDecimal, ctx: z.RefinementCtx): number {
  const n = Number(p.canonical);
  const significant = (p.intPart.replace(/^0+/, "") + p.fracPart).replace(/^0+/, "").length;
  if (!Number.isFinite(n) || significant > 15) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Too many digits" });
    return z.NEVER;
  }
  return n;
}

// ── Quantities ────────────────────────────────────────────────────────────

export interface QuantityOptions extends LocaleOption {
  /** Instrument lot step (e.g. 0.01 contracts). The value must be a whole multiple. */
  step?: number;
  min?: number;
  max?: number;
}

/** Contract / share quantity: positive, a multiple of the instrument step, within bounds. */
export function quantitySchema({ step = 0.01, min = step, max = 1_000_000, locale }: QuantityOptions = {}) {
  const dp = stepDecimals(step);
  const stepUnits = BigInt(Math.round(step * 10 ** dp));
  return decimal({ locale }).transform((p, ctx) => {
    if (fractionDigits(p) > dp) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${dp} decimal place${dp === 1 ? "" : "s"}` });
      return z.NEVER;
    }
    const units = toBaseUnits(p, dp)!;
    if (units % stepUnits !== 0n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Must be a multiple of ${fmt(step)}` });
      return z.NEVER;
    }
    const n = toSafeNumber(p, ctx);
    if (n < min) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, inclusive: true, type: "number", message: `Minimum is ${fmt(min)}` });
    if (n > max) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: "number", message: `Maximum is ${fmt(max)}` });
    return n;
  });
}

// ── Prices / strikes / thresholds ────────────────────────────────────────

export interface PriceOptions extends LocaleOption {
  /** Exclusive lower bound (default 0 — prices must be > 0). */
  gt?: number;
  max?: number;
  /** Stellar amounts have 7 decimals. */
  maxDecimals?: number;
}

export function priceSchema({ gt = 0, max = 1_000_000_000, maxDecimals = 7, locale }: PriceOptions = {}) {
  return decimal({ locale }).transform((p, ctx) => {
    if (fractionDigits(p) > maxDecimals) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${maxDecimals} decimal places` });
      return z.NEVER;
    }
    const n = toSafeNumber(p, ctx);
    if (!(n > gt)) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: gt, inclusive: false, type: "number", message: gt === 0 ? "Must be greater than 0" : `Must be greater than ${fmt(gt)}` });
    if (n > max) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: "number", message: `Maximum is ${fmt(max)}` });
    return n;
  });
}

// ── Percentages ──────────────────────────────────────────────────────────

export interface PercentOptions extends LocaleOption {
  min?: number;
  max?: number;
  maxDecimals?: number;
}

/** Percentage as typed (e.g. "12.5" → 12.5, not 0.125). Accepts a trailing "%". */
export function percentSchema({ min = 0, max = 100, maxDecimals = 2, locale }: PercentOptions = {}) {
  return z
    .string()
    .transform((s) => s.trim().replace(/\s*%$/, ""))
    .pipe(decimal({ locale, allowNegative: min < 0 }))
    .transform((p, ctx) => {
      if (fractionDigits(p) > maxDecimals) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${maxDecimals} decimal places` });
        return z.NEVER;
      }
      const n = toSafeNumber(p, ctx);
      if (n < min) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, inclusive: true, type: "number", message: `Minimum is ${fmt(min)}%` });
      if (n > max) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: "number", message: `Maximum is ${fmt(max)}%` });
      return n;
    });
}

// ── Integers (days, counts) ──────────────────────────────────────────────

export function integerSchema({ min = 0, max = Number.MAX_SAFE_INTEGER, locale }: LocaleOption & { min?: number; max?: number } = {}) {
  return decimal({ locale, allowNegative: min < 0 }).transform((p, ctx) => {
    if (p.fracPart !== "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Must be a whole number" });
      return z.NEVER;
    }
    const n = toSafeNumber(p, ctx);
    if (n < min) ctx.addIssue({ code: z.ZodIssueCode.too_small, minimum: min, inclusive: true, type: "number", message: `Minimum is ${fmt(min)}` });
    if (n > max) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: max, inclusive: true, type: "number", message: `Maximum is ${fmt(max)}` });
    return n;
  });
}

// ── On-chain amounts (bigint, i128) ──────────────────────────────────────

export const I128_MAX = (1n << 127n) - 1n;
export const I128_MIN = -(1n << 127n);

export interface AmountOptions extends LocaleOption {
  /** Token decimals (7 for Stellar assets / SAC). */
  decimals?: number;
  /** Bounds in base units. Defaults: > 0 and ≤ i128 max. */
  minUnits?: bigint;
  maxUnits?: bigint;
}

/**
 * Token amount → exact integer base units (bigint). Never goes through a
 * double, so values beyond Number.MAX_SAFE_INTEGER stay exact.
 */
export function amountSchema({ decimals = 7, minUnits = 1n, maxUnits = I128_MAX, locale }: AmountOptions = {}) {
  return decimal({ locale, allowNegative: minUnits < 0n }).transform((p, ctx): bigint => {
    const units = toBaseUnits(p, decimals);
    if (units === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `At most ${decimals} decimal places` });
      return z.NEVER;
    }
    if (units < minUnits) ctx.addIssue({ code: z.ZodIssueCode.custom, message: minUnits === 1n ? "Must be greater than 0" : "Amount is too small" });
    if (units > maxUnits) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Amount is too large" });
    return units;
  });
}

// ── Stellar addresses ────────────────────────────────────────────────────

const STRKEY_MESSAGES: Record<StrKeyError, string> = {
  empty: "Required",
  length: "Wrong length for a Stellar address",
  charset: "Stellar addresses contain only A–Z and 2–7",
  version: "Wrong address type",
  checksum: "Invalid address (checksum mismatch) — check for typos",
  secret: "This is a SECRET key. Never paste or share it — use your public address (G…)",
};

function strkey(kind: "account" | "contract") {
  const prefix = kind === "account" ? "G" : "C";
  return z.string().transform((raw, ctx) => {
    // Trim surrounding whitespace from pastes; interior whitespace/zero-width is an error.
    const s = raw.trim();
    const r = checkStrKey(s, kind);
    if (!r.ok) {
      const message = r.error === "version"
        ? `Expected ${kind === "account" ? "an account" : "a contract"} address starting with ${prefix}`
        : STRKEY_MESSAGES[r.error];
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return s;
  });
}

/** G… account id, checksum-validated. */
export const accountIdSchema = strkey("account");
/** C… contract id, checksum-validated. */
export const contractIdSchema = strkey("contract");

// ── Dates ────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" that exists on the calendar (rejects 2026-02-30), within optional bounds. */
export function dateSchema({ min, max }: { min?: string; max?: string } = {}) {
  return z.string().transform((raw, ctx) => {
    const s = raw.trim();
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
    if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date (YYYY-MM-DD)" });
      return z.NEVER;
    }
    if (min && s < min) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Date must be on or after ${min}` });
    if (max && s > max) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Date must be on or before ${max}` });
    return s;
  });
}

// ── Search ───────────────────────────────────────────────────────────────

/** Free-text search: trimmed, control characters removed, length-capped. */
export const searchSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001F\u007F-\u009F‪-‮⁦-⁩]/g, "").trim())
  .pipe(z.string().max(100, "Search is too long"));

/** Convenience: first error message, or null. */
export function firstError(result: z.SafeParseReturnType<unknown, unknown>): string | null {
  return result.success ? null : result.error.issues[0]?.message ?? "Invalid value";
}
