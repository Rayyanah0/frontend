/** @jest-environment node */
import { parseRetryAfter } from "../retryAfter";
import { RetryBudget } from "../budget";

const NOW = Date.parse("2026-01-01T00:00:00Z");

describe("parseRetryAfter", () => {
  it.each([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    ["0", 0],
    ["1", 1000],
    ["120", 120_000],
    [" 5 ", 5000],
    ["-3", null],
    ["1.5", null],
    ["abc", null],
    ["0x10", null],
    ["99999999", 300_000], // capped at 5 min
  ])("%p → %p", (header, expected) => {
    expect(parseRetryAfter(header as string | null, NOW)).toBe(expected);
  });

  it("parses an HTTP-date relative to now", () => {
    expect(parseRetryAfter("Thu, 01 Jan 2026 00:00:30 GMT", NOW)).toBe(30_000);
  });

  it("clamps past HTTP-dates to 0", () => {
    expect(parseRetryAfter("Wed, 31 Dec 2025 23:59:00 GMT", NOW)).toBe(0);
  });

  it("caps far-future HTTP-dates", () => {
    expect(parseRetryAfter("Fri, 01 Jan 2027 00:00:00 GMT", NOW, 60_000)).toBe(60_000);
  });

  it("rejects non-HTTP-date strings that Date.parse would accept", () => {
    expect(parseRetryAfter("2026-01-02", NOW)).toBeNull();
    expect(parseRetryAfter("tomorrow", NOW)).toBeNull();
  });
});

describe("RetryBudget", () => {
  it("starts with the reserve and spends one token per retry", () => {
    const b = new RetryBudget({ reserve: 2, ratio: 0.5, max: 10 });
    expect(b.tryWithdraw()).toBe(true);
    expect(b.tryWithdraw()).toBe(true);
    expect(b.tryWithdraw()).toBe(false);
  });

  it("refills by ratio per request", () => {
    const b = new RetryBudget({ reserve: 0, ratio: 0.25, max: 10 });
    for (let i = 0; i < 3; i++) b.deposit();
    expect(b.tryWithdraw()).toBe(false);
    b.deposit();
    expect(b.tryWithdraw()).toBe(true);
  });

  it("caps the balance at max", () => {
    const b = new RetryBudget({ reserve: 1, ratio: 1, max: 3 });
    for (let i = 0; i < 100; i++) b.deposit();
    expect(b.balance).toBe(3);
  });

  it("never lets max drop below the reserve", () => {
    expect(new RetryBudget({ reserve: 5, max: 1 }).max).toBe(5);
  });
});
