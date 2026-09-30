import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Position } from "./api/types.ts";
import {
  analyze,
  byHoldingPeriod,
  byOptionType,
  byPositionType,
  byStrategy,
  byUnderlying,
  closedTrades,
  computeStats,
  equityCurve,
  holdingPeriodBucket,
} from "./analytics.ts";

function trade(partial: Partial<Position> & Pick<Position, "id" | "realized_pnl" | "closed_at">): Position {
  return {
    wallet_address: "G...",
    underlying: "BTC",
    strike: 100,
    expiry_days: 30,
    option_type: "call",
    position_type: "long",
    contracts: 1,
    entry_premium: 5,
    entry_spot: 100,
    collateral: 0,
    status: "closed",
    close_premium: 6,
    close_spot: 105,
    opened_at: "2024-01-01T00:00:00.000Z",
    strategy_id: null,
    ...partial,
  };
}

describe("closedTrades", () => {
  it("includes rolled positions and sorts by closed_at", () => {
    const a = trade({ id: "1", realized_pnl: 1, closed_at: "2024-01-03T00:00:00.000Z" });
    const b = trade({ id: "2", realized_pnl: 2, closed_at: "2024-01-02T00:00:00.000Z", status: "rolled" });
    const open = trade({ id: "3", realized_pnl: null, closed_at: null, status: "open" });
    const sorted = closedTrades([a, b, open]);
    assert.deepEqual(sorted.map(t => t.id), ["2", "1"]);
  });
});

describe("computeStats fixtures", () => {
  const fixtures = [
    trade({ id: "w1", realized_pnl: 100, closed_at: "2024-01-01T12:00:00.000Z", underlying: "BTC", option_type: "call", position_type: "long" }),
    trade({ id: "w2", realized_pnl: 50, closed_at: "2024-01-02T12:00:00.000Z", underlying: "ETH", option_type: "put", position_type: "short" }),
    trade({ id: "l1", realized_pnl: -40, closed_at: "2024-01-03T12:00:00.000Z", underlying: "BTC", option_type: "call", position_type: "long", strategy_id: "s1" }),
  ];

  it("computes hand-verified totals", () => {
    const s = computeStats(fixtures);
    assert.equal(s.tradeCount, 3);
    assert.equal(s.totalPnl, 110);
    assert.equal(s.winCount, 2);
    assert.equal(s.lossCount, 1);
    assert.ok(Math.abs(s.winRate - 2 / 3) < 1e-6);
    assert.ok(Math.abs(s.profitFactor - 150 / 40) < 1e-6);
    assert.ok(Math.abs(s.expectancy - 110 / 3) < 1e-6);
    assert.ok(Math.abs(s.avgWin - 75) < 1e-6);
    assert.ok(Math.abs(s.avgLoss - -40) < 1e-6);
  });

  it("returns Infinity profit factor when all wins", () => {
    const s = computeStats(fixtures.filter(t => (t.realized_pnl ?? 0) > 0));
    assert.equal(s.profitFactor, Infinity);
  });

  it("handles zero trades", () => {
    const s = computeStats([]);
    assert.equal(s.tradeCount, 0);
    assert.equal(s.totalPnl, 0);
    assert.equal(s.winRate, 0);
    assert.equal(s.profitFactor, 0);
    assert.equal(s.sharpeLike, 0);
  });

  it("builds equity curve and drawdown", () => {
    const curve = equityCurve(fixtures);
    assert.deepEqual(curve.map(p => p.equity), [100, 150, 110]);
    assert.equal(curve[2].drawdown, -40);
    const s = computeStats(fixtures);
    assert.equal(s.maxDrawdown, -40);
  });

  it("breakdowns by dimension", () => {
    assert.equal(byUnderlying(fixtures).find(r => r.key === "BTC")!.totalPnl, 60);
    assert.equal(byOptionType(fixtures).find(r => r.key === "call")!.count, 2);
    assert.equal(byPositionType(fixtures).find(r => r.key === "short")!.totalPnl, 50);
    assert.equal(byStrategy(fixtures).find(r => r.key === "strategy")!.count, 1);
    assert.equal(byStrategy(fixtures).find(r => r.key === "single")!.count, 2);
  });

  it("holding period buckets", () => {
    const t = trade({
      id: "h",
      realized_pnl: 1,
      closed_at: "2024-01-10T00:00:00.000Z",
      opened_at: "2024-01-01T00:00:00.000Z",
    });
    assert.equal(holdingPeriodBucket(t), "7–30d");
    assert.equal(byHoldingPeriod([t])[0].key, "7–30d");
  });

  it("analyze wires everything", () => {
    const a = analyze(fixtures);
    assert.equal(a.stats.totalPnl, 110);
    assert.equal(a.curve.length, 3);
  });
});
