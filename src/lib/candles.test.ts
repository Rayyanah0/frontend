import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateTicks,
  updateCandleWithTick,
  bucketStart,
  computeSma,
  computeEma,
  realizedVol,
} from "./candles";

describe("candles", () => {
  it("aggregates ticks into OHLC buckets", () => {
    const t0 = bucketStart(1_700_000_000_000, "1m") * 1000;
    const candles = aggregateTicks(
      [
        { t: t0 + 1000, price: 100 },
        { t: t0 + 2000, price: 110 },
        { t: t0 + 3000, price: 90 },
        { t: t0 + 4000, price: 105 },
        { t: t0 + 60_000 + 500, price: 108 },
      ],
      "1m"
    );
    assert.equal(candles.length, 2);
    assert.equal(candles[0].open, 100);
    assert.equal(candles[0].high, 110);
    assert.equal(candles[0].low, 90);
    assert.equal(candles[0].close, 105);
    assert.equal(candles[1].open, 108);
  });

  it("updates the live candle at bucket boundaries", () => {
    const t0 = bucketStart(1_700_000_000_000, "1m");
    let candles = [{ time: t0, open: 10, high: 10, low: 10, close: 10 }];
    candles = updateCandleWithTick(candles, { t: t0 * 1000 + 1000, price: 12 }, "1m");
    assert.equal(candles.length, 1);
    assert.equal(candles[0].high, 12);
    candles = updateCandleWithTick(candles, { t: (t0 + 60) * 1000, price: 11 }, "1m");
    assert.equal(candles.length, 2);
    assert.equal(candles[1].open, 11);
  });

  it("computes SMA / EMA", () => {
    const v = [1, 2, 3, 4, 5];
    assert.ok(Math.abs((computeSma(v, 3)[4] as number) - 4) < 1e-9);
    assert.ok(Math.abs((computeEma(v, 3)[2] as number) - 2) < 1e-9);
  });

  it("computes realized vol and leaves early bars null", () => {
    const closes = Array.from({ length: 30 }, (_, i) => 100 * Math.exp(0.001 * i));
    const rv = realizedVol(closes, 20, 252);
    assert.equal(rv[19], null);
    assert.notEqual(rv[20], null);
    assert.ok((rv[20] as number) > 0);
  });
});
