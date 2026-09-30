/** @jest-environment node */
import fc from "fast-check";
import { amountSchema, formatForInput, fromBaseUnits, parseDecimal, quantitySchema, toBaseUnits } from "..";

const LOCALES = ["en-US", "de-DE", "fr-FR", "en-IN", "ja-JP"];

describe("parseDecimal fuzzing", () => {
  it("never throws, whatever the input", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary", maxLength: 80 }), fc.constantFrom(...LOCALES), fc.boolean(), (s, locale, neg) => {
        const r = parseDecimal(s, { locale, allowNegative: neg });
        expect(typeof r.ok).toBe("boolean");
      }),
      { numRuns: 5000 },
    );
  });

  it("accepted input always yields a canonical decimal that Number() agrees with", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 30 }), fc.constantFrom(...LOCALES), (s, locale) => {
        const r = parseDecimal(s, { locale, allowNegative: true });
        if (!r.ok) return;
        expect(r.value.canonical).toMatch(/^-?(0|[1-9]\d*)(\.\d*[1-9])?$/);
        expect(Number.isNaN(Number(r.value.canonical))).toBe(false);
      }),
      { numRuns: 5000 },
    );
  });

  it("only digits survive: any letter makes the input invalid (no '1O' → 1)", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{1,6}$/),
        fc.constantFrom(..."OolIiSsBbZzeE$€%xX".split("")),
        fc.nat({ max: 6 }),
        (digits, letter, at) => {
          const pos = Math.min(at, digits.length);
          const s = digits.slice(0, pos) + letter + digits.slice(pos);
          expect(parseDecimal(s, { locale: "en-US" }).ok).toBe(false);
        },
      ),
    );
  });

  it("round-trips numbers formatted for the locale", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e12, noNaN: true, noDefaultInfinity: true }),
        fc.constantFrom(...LOCALES),
        (n, locale) => {
          const text = formatForInput(n, locale);
          const r = parseDecimal(text, { locale });
          expect(r.ok).toBe(true);
          if (r.ok) expect(Number(r.value.canonical)).toBeCloseTo(Number(n.toFixed(7)), 6);
        },
      ),
    );
  });

  it("round-trips Intl-formatted numbers with grouping", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1e12 }), fc.nat({ max: 99 }), fc.constantFrom("en-US", "de-DE", "fr-FR"), (int, cents, locale) => {
        const n = int + cents / 100;
        const text = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
        const r = parseDecimal(text, { locale });
        expect(r.ok).toBe(true);
        if (r.ok) expect(r.value.canonical).toBe(fromBaseUnits(BigInt(int) * 100n + BigInt(cents), 2));
      }),
    );
  });

  it("scientific notation is always rejected", () => {
    fc.assert(
      fc.property(fc.double({ noNaN: true, noDefaultInfinity: true }), (n) => {
        const exp = n.toExponential();
        expect(parseDecimal(exp, { locale: "en-US", allowNegative: true }).ok).toBe(false);
      }),
    );
  });

  it("negative zero always normalises to 0", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^-0{1,5}(\.0{0,5})?$/), (s) => {
        const r = parseDecimal(s, { locale: "en-US", allowNegative: true });
        expect(r).toMatchObject({ ok: true, value: { canonical: "0", negative: false } });
      }),
    );
  });
});

describe("bigint amount path", () => {
  it("toBaseUnits / fromBaseUnits round-trip any i128-range value exactly", () => {
    const i128 = fc.bigInt({ min: -(1n << 127n), max: (1n << 127n) - 1n });
    fc.assert(
      fc.property(i128, fc.integer({ min: 0, max: 18 }), (units, decimals) => {
        const text = fromBaseUnits(units, decimals);
        const r = parseDecimal(text, { locale: "en-US", allowNegative: true });
        expect(r.ok).toBe(true);
        if (r.ok) expect(toBaseUnits(r.value, decimals)).toBe(units);
      }),
    );
  });

  it("amountSchema never loses precision on large values", () => {
    const schema = amountSchema({ decimals: 7, locale: "en-US" });
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: (1n << 127n) - 1n }), (units) => {
        expect(schema.parse(fromBaseUnits(units, 7))).toBe(units);
      }),
    );
  });
});

describe("quantitySchema fuzzing", () => {
  it("accepted quantities are always within bounds and on the step grid", () => {
    const schema = quantitySchema({ step: 0.01, min: 0.01, max: 1000, locale: "en-US" });
    fc.assert(
      fc.property(fc.string({ maxLength: 12 }), (s) => {
        const r = schema.safeParse(s);
        if (!r.success) return;
        expect(r.data).toBeGreaterThanOrEqual(0.01);
        expect(r.data).toBeLessThanOrEqual(1000);
        expect(Math.round(r.data * 100)).toBeCloseTo(r.data * 100, 6);
      }),
      { numRuns: 5000 },
    );
  });
});
