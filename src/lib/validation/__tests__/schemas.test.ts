/** @jest-environment node */
import {
  accountIdSchema,
  amountSchema,
  contractIdSchema,
  dateSchema,
  encodeStrKey,
  firstError,
  fromBaseUnits,
  I128_MAX,
  integerSchema,
  parseDecimal,
  percentSchema,
  priceSchema,
  quantitySchema,
  searchSchema,
  checkStrKey,
  crc16xmodem,
  formatForInput,
  localeSeparators,
} from "..";

const EN = { locale: "en-US" };
const DE = { locale: "de-DE" };
const FR = { locale: "fr-FR" };

// ── parseDecimal ─────────────────────────────────────────────────────────
describe("parseDecimal (table)", () => {
  type Row = [input: string, locale: string, expected: string | { error: string }, allowNegative?: boolean];
  const rows: Row[] = [
    // plain
    ["12", "en-US", "12"],
    ["12.5", "en-US", "12.5"],
    [".5", "en-US", "0.5"],
    ["12.", "en-US", "12"],
    ["0", "en-US", "0"],
    ["007", "en-US", "7"],
    ["1.500", "en-US", "1.5"],
    ["  42  ", "en-US", "42"],
    [" 42 ", "en-US", "42"],
    ["4​2", "en-US", "42"],
    ["+3", "en-US", "3"],
    // grouping
    ["1,234", "en-US", "1234"],
    ["1,234,567.25", "en-US", "1234567.25"],
    ["1.234", "de-DE", "1234"],
    ["1.234,5", "de-DE", "1234.5"],
    ["1 234,5", "fr-FR", "1234.5"],
    ["1 234,5", "fr-FR", "1234.5"],
    // locale decimal
    ["12,5", "de-DE", "12.5"],
    [",5", "de-DE", "0.5"],
    ["1.5", "fr-FR", "1.5"], // "." can't be a group separator in fr → unambiguous decimal
    // negatives / zero
    ["-3", "en-US", "-3", true],
    ["−3", "en-US", "-3", true],
    ["-0", "en-US", "0", true],
    ["-0.000", "en-US", "0", true],
    ["-3", "en-US", { error: "negative" }],
    // rejections
    ["", "en-US", { error: "required" }],
    ["   ", "en-US", { error: "required" }],
    ["1O", "en-US", { error: "invalid" }],
    ["l0", "en-US", { error: "invalid" }],
    ["abc", "en-US", { error: "invalid" }],
    ["1e3", "en-US", { error: "scientific" }],
    ["1E-7", "en-US", { error: "scientific" }],
    ["2.5e10", "en-US", { error: "scientific" }],
    ["0x10", "en-US", { error: "hex" }],
    ["0b101", "en-US", { error: "hex" }],
    ["0o17", "en-US", { error: "hex" }],
    ["Infinity", "en-US", { error: "invalid" }],
    ["NaN", "en-US", { error: "invalid" }],
    ["1.2.3", "en-US", { error: "invalid" }],
    ["1,23.4", "en-US", { error: "invalid" }],
    ["12,34,567", "en-US", { error: "invalid" }],
    ["--1", "en-US", { error: "invalid" }, true],
    ["1-", "en-US", { error: "invalid" }],
    ["１２", "en-US", { error: "invalid" }],
    ["٣", "en-US", { error: "invalid" }],
    [".", "en-US", { error: "invalid" }],
    ["1 000", "en-US", { error: "invalid" }],
    ["1,5", "en-US", { error: "wrong_separator" }],
    ["1.5", "de-DE", { error: "wrong_separator" }],
    ["1,500.5,", "en-US", { error: "invalid" }],
    ["9".repeat(80), "en-US", { error: "too_long" }],
    ["$5", "en-US", { error: "invalid" }],
    ["5%", "en-US", { error: "invalid" }],
  ];

  it("has at least 50 rows", () => expect(rows.length).toBeGreaterThanOrEqual(50));

  it.each(rows)("%p [%s] → %p", (input, locale, expected, allowNegative) => {
    const r = parseDecimal(input, { locale, allowNegative });
    if (typeof expected === "string") {
      expect(r).toMatchObject({ ok: true, value: { canonical: expected } });
    } else {
      expect(r).toEqual({ ok: false, error: expected.error });
    }
  });
});

describe("localeSeparators", () => {
  it("resolves common locales", () => {
    expect(localeSeparators("en-US")).toEqual({ decimal: ".", group: "," });
    expect(localeSeparators("de-DE")).toEqual({ decimal: ",", group: "." });
    expect(localeSeparators("fr-FR")).toEqual({ decimal: ",", group: " " });
  });
  it("falls back for invalid tags", () => {
    expect(localeSeparators("not a locale!!")).toEqual({ decimal: ".", group: "," });
  });
});

// ── quantity ─────────────────────────────────────────────────────────────
describe("quantitySchema", () => {
  const q = quantitySchema({ step: 0.01, min: 0.01, max: 1000, ...EN });
  it.each([
    ["1", 1],
    ["0.01", 0.01],
    ["2.50", 2.5],
    ["1000", 1000],
    ["1,000", 1000],
  ])("accepts %p", (input, n) => expect(q.parse(input)).toBe(n));

  it.each([
    ["1O", "Not a valid number"],
    ["0", "Minimum is 0.01"],
    ["0.001", "At most 2 decimal places"],
    ["1000.01", "Maximum is 1,000"],
    ["", "Required"],
    ["1e2", "Scientific notation isn't allowed — type the full number"],
    ["-1", "Must not be negative"],
  ])("rejects %p with %p", (input, message) => expect(firstError(q.safeParse(input))).toBe(message));

  it("enforces non-decimal steps", () => {
    const lots = quantitySchema({ step: 0.05, ...EN });
    expect(lots.safeParse("0.15").success).toBe(true);
    expect(firstError(lots.safeParse("0.12"))).toBe("Must be a multiple of 0.05");
    const whole = quantitySchema({ step: 1, ...EN });
    expect(firstError(whole.safeParse("1.5"))).toBe("At most 0 decimal places");
  });

  it("parses locale decimals", () => {
    expect(quantitySchema({ step: 0.01, ...DE }).parse("2,5")).toBe(2.5);
  });
});

// ── price / percent / integer ───────────────────────────────────────────
describe("priceSchema", () => {
  const p = priceSchema({ maxDecimals: 7, ...EN });
  it("accepts positive prices", () => expect(p.parse("0.1234567")).toBe(0.1234567));
  it("rejects zero", () => expect(firstError(p.safeParse("0"))).toBe("Must be greater than 0"));
  it("rejects excess precision", () => expect(firstError(p.safeParse("0.12345678"))).toBe("At most 7 decimal places"));
  it("rejects more than 15 significant digits", () => expect(firstError(p.safeParse("123456789.1234567"))).toBe("Too many digits"));
});

describe("percentSchema", () => {
  const pct = percentSchema({ min: -50, max: 50, ...EN });
  it.each([["12.5", 12.5], ["12.5%", 12.5], ["-10 %", -10], ["0", 0]])("%p → %p", (i, n) => expect(pct.parse(i)).toBe(n));
  it("bounds", () => {
    expect(firstError(pct.safeParse("51"))).toBe("Maximum is 50%");
    expect(firstError(pct.safeParse("-51"))).toBe("Minimum is -50%");
    expect(firstError(pct.safeParse("1.234"))).toBe("At most 2 decimal places");
  });
  it("rejects negatives when min ≥ 0", () => {
    expect(firstError(percentSchema(EN).safeParse("-1"))).toBe("Must not be negative");
  });
});

describe("integerSchema", () => {
  const days = integerSchema({ min: 1, max: 365, ...EN });
  it("accepts integers", () => expect(days.parse("30")).toBe(30));
  it("rejects fractions", () => expect(firstError(days.safeParse("30.5"))).toBe("Must be a whole number"));
  it("bounds", () => expect(firstError(days.safeParse("0"))).toBe("Minimum is 1"));
});

// ── bigint amounts ───────────────────────────────────────────────────────
describe("amountSchema (bigint path)", () => {
  const amt = amountSchema({ decimals: 7, ...EN });
  it("converts exactly to base units", () => {
    expect(amt.parse("1")).toBe(10_000_000n);
    expect(amt.parse("0.0000001")).toBe(1n);
    expect(amt.parse("123.4567891")).toBe(1_234_567_891n);
  });
  it("stays exact beyond MAX_SAFE_INTEGER", () => {
    const big = "922337203685477580.7"; // far beyond 2^53 in base units
    expect(amt.parse(big)).toBe(9_223_372_036_854_775_807_000_000n);
    expect(fromBaseUnits(amt.parse(big), 7)).toBe(big);
  });
  it("accepts the i128 max and rejects above it", () => {
    const max = fromBaseUnits(I128_MAX, 7);
    expect(amt.parse(max)).toBe(I128_MAX);
    // one more base unit
    expect(firstError(amt.safeParse(fromBaseUnits(I128_MAX + 1n, 7)))).toBe("Amount is too large");
  });
  it("rejects more decimals than the token has", () => {
    expect(firstError(amt.safeParse("0.00000001"))).toBe("At most 7 decimal places");
  });
  it("rejects zero by default", () => {
    expect(firstError(amt.safeParse("0"))).toBe("Must be greater than 0");
  });
  it("normalises negative zero when negatives are allowed", () => {
    expect(amountSchema({ minUnits: -10n, ...EN }).parse("-0")).toBe(0n);
  });
});

// ── StrKey ───────────────────────────────────────────────────────────────
const payload = (seed: number) => Uint8Array.from({ length: 32 }, (_, i) => (i * 31 + seed) & 0xff);
const G = encodeStrKey("account", payload(1));
const C = encodeStrKey("contract", payload(2));
const S = encodeStrKey("seed", payload(3));

describe("StrKey", () => {
  it("crc16xmodem matches the reference check value", () => {
    expect(crc16xmodem(new TextEncoder().encode("123456789"))).toBe(0x31c3);
  });

  it("accepts known SEP-23 vectors", () => {
    expect(checkStrKey("GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ", "account")).toEqual({ ok: true });
    expect(checkStrKey("CA3D5KRYM6CB7OWQ6TWYRR3Z4T7GNZLKERYNZGGA5SOAOPIFY6YQGAXE", "contract")).toEqual({ ok: true });
  });

  it("round-trips generated keys", () => {
    expect(accountIdSchema.parse(G)).toBe(G);
    expect(contractIdSchema.parse(C)).toBe(C);
    expect(G[0]).toBe("G");
    expect(C[0]).toBe("C");
  });

  it("trims pasted whitespace", () => {
    expect(accountIdSchema.parse(`  ${G}\n`)).toBe(G);
  });

  it.each([
    ["checksum", G.slice(0, 55) + (G[55] === "A" ? "B" : "A"), "Invalid address (checksum mismatch) — check for typos"],
    ["length", G.slice(0, 55), "Wrong length for a Stellar address"],
    ["lowercase", G.toLowerCase(), "Stellar addresses contain only A–Z and 2–7"],
    ["charset", G.slice(0, 55) + "1", "Stellar addresses contain only A–Z and 2–7"],
    ["contract as account", C, "Expected an account address starting with G"],
    ["account as contract", G, "Expected a contract address starting with C"],
    ["secret seed", S, "This is a SECRET key. Never paste or share it — use your public address (G…)"],
    ["homoglyph", "GА" + G.slice(2), "Stellar addresses contain only A–Z and 2–7"],
    ["zero-width", G.slice(0, 10) + "​" + G.slice(10, 55), "Stellar addresses contain only A–Z and 2–7"],
    ["empty", "", "Required"],
  ])("rejects %s", (_name, input, message) => {
    const schema = _name === "account as contract" ? contractIdSchema : accountIdSchema;
    expect(firstError(schema.safeParse(input))).toBe(message);
  });
});

// ── dates / search ───────────────────────────────────────────────────────
describe("dateSchema", () => {
  const d = dateSchema({ min: "2026-01-01", max: "2026-12-31" });
  it.each(["2026-02-28", "2026-12-31", " 2026-06-15 "])("accepts %p", (s) => expect(d.safeParse(s).success).toBe(true));
  it.each([
    ["2026-02-30", "Enter a valid date (YYYY-MM-DD)"],
    ["2026-13-01", "Enter a valid date (YYYY-MM-DD)"],
    ["26-01-01", "Enter a valid date (YYYY-MM-DD)"],
    ["2025-12-31", "Date must be on or after 2026-01-01"],
    ["2027-01-01", "Date must be on or before 2026-12-31"],
  ])("rejects %p", (s, message) => expect(firstError(d.safeParse(s))).toBe(message));
  it("handles leap years", () => {
    expect(dateSchema().safeParse("2028-02-29").success).toBe(true);
    expect(dateSchema().safeParse("2026-02-29").success).toBe(false);
  });
});

describe("searchSchema", () => {
  it("strips control/bidi chars and trims", () => expect(searchSchema.parse("  xl‮m\u0000 ")).toBe("xlm"));
  it("caps length", () => expect(searchSchema.safeParse("a".repeat(101)).success).toBe(false));
});

describe("formatForInput", () => {
  it.each([
    [1, "en-US", "1"],
    [2.5, "de-DE", "2,5"],
    [0.1 + 0.2, "en-US", "0.3"],
    [1e-7, "en-US", "0.0000001"],
    [1e20, "en-US", "100000000000000000000"],
    [NaN, "en-US", ""],
  ])("%p [%s] → %p", (n, locale, expected) => expect(formatForInput(n, locale)).toBe(expected));
});

describe("French locale", () => {
  it("accepts space-grouped comma decimals", () => {
    expect(priceSchema(FR).parse("1 234,5")).toBe(1234.5);
  });
});
