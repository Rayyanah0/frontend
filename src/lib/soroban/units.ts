/**
 * Exact fixed-point helpers for Soroban integer types (u64/u128/i128).
 *
 * Everything goes through bigint — never Number — so i128 values beyond
 * 2^53 render and compare exactly. Pure module, no SDK imports.
 */

/**
 * Converts a human decimal ("12.5", 12.5, 12n) into base units at the given
 * precision. Throws on malformed input or on more fractional digits than
 * `decimals` allows (silently truncating would hide a mismatch).
 */
export function toBaseUnits(value: string | number | bigint, decimals: number): bigint {
  if (typeof value === "bigint") return value * 10n ** BigInt(decimals);
  const text = typeof value === "number" ? numberToPlainString(value, decimals) : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new RangeError(`Not a decimal number: "${text}"`);
  const [, sign, whole, rawFraction = ""] = match;
  const fraction = rawFraction.replace(/0+$/, "");
  if (fraction.length > decimals) {
    throw new RangeError(`"${text}" has more than ${decimals} decimal places`);
  }
  const units = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0") || "0");
  return sign ? -units : units;
}

function numberToPlainString(value: number, decimals: number): string {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  // toFixed avoids exponent notation and float noise (0.1 + 0.2) up to 100 dp.
  return value.toFixed(Math.min(100, decimals));
}

/** Renders base units as an exact decimal string with grouping, e.g. 12345000000n @7 → "1,234.5". */
export function formatBaseUnits(units: bigint, decimals: number, opts: { minFractionDigits?: number; group?: boolean } = {}): string {
  const { minFractionDigits = 0, group = true } = opts;
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const scale = 10n ** BigInt(decimals);
  const whole = (abs / scale).toString();
  let fraction = decimals > 0 ? (abs % scale).toString().padStart(decimals, "0").replace(/0+$/, "") : "";
  if (fraction.length < minFractionDigits) fraction = fraction.padEnd(minFractionDigits, "0");
  const grouped = group ? whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") : whole;
  return `${negative ? "-" : ""}${grouped}${fraction ? `.${fraction}` : ""}`;
}

/** "GABCD…WXYZ" — enough characters to spot a swapped address at a glance. */
export function shortenAddress(address: string, head = 5, tail = 5): string {
  if (address.length <= head + tail + 1) return address;
  return `${address.slice(0, head)}…${address.slice(-tail)}`;
}
