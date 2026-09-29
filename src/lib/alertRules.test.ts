import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clearedWithHysteresis,
  compare,
  evaluate,
  resolveMetric,
  type AlertRule,
  type MarketState,
  type PortfolioState,
} from "./alertRules.ts";

const market = (over: Partial<MarketState> = {}): MarketState => ({
  spots: { BTC: 100 },
  vols: { BTC: 0.8 },
  feedAgeMs: 1000,
  ...over,
});

const portfolio = (over: Partial<PortfolioState> = {}): PortfolioState => ({
  netDelta: 2,
  netGamma: 0.1,
  netVega: 5,
  positions: [
    { id: "p1", underlying: "BTC", pnlPct: -20, dte: 3, status: "open" },
  ],
  ...over,
});

function rule(partial: Partial<AlertRule> & Pick<AlertRule, "condition">): AlertRule {
  return {
    id: "r1",
    name: "test",
    cooldownMs: 60_000,
    hysteresis: 1,
    enabled: true,
    createdAt: new Date().toISOString(),
    lastFiredAt: null,
    armed: false,
    ...partial,
  };
}

describe("compare / hysteresis", () => {
  it("compares operators", () => {
    assert.equal(compare("gt", 5, 4), true);
    assert.equal(compare("lte", 4, 4), true);
    assert.equal(compare("lt", 4, 4), false);
  });

  it("clears with hysteresis away from trigger side", () => {
    assert.equal(clearedWithHysteresis("gt", 8, 10, 1), true);
    assert.equal(clearedWithHysteresis("gt", 9.5, 10, 1), false);
    assert.equal(clearedWithHysteresis("lt", 12, 10, 1), true);
  });
});

describe("resolveMetric", () => {
  it("resolves spot, iv%, greeks, pnl, dte", () => {
    assert.equal(resolveMetric({ metric: "spot", operator: "gt", threshold: 0, underlying: "BTC" }, market(), portfolio()), 100);
    assert.ok(Math.abs(resolveMetric({ metric: "iv", operator: "gt", threshold: 0, underlying: "BTC" }, market(), portfolio())! - 80) < 1e-9);
    assert.equal(resolveMetric({ metric: "portfolio_delta", operator: "gt", threshold: 0 }, market(), portfolio()), 2);
    assert.equal(resolveMetric({ metric: "position_pnl_pct", operator: "lt", threshold: 0, positionId: "p1" }, market(), portfolio()), -20);
    assert.equal(resolveMetric({ metric: "dte", operator: "lt", threshold: 0, positionId: "p1" }, market(), portfolio()), 3);
  });

  it("returns null for closed positions", () => {
    const p = portfolio({ positions: [{ id: "p1", underlying: "BTC", pnlPct: -50, dte: 1, status: "closed" }] });
    assert.equal(resolveMetric({ metric: "position_pnl_pct", operator: "lt", threshold: -10, positionId: "p1" }, market(), p), null);
  });
});

describe("evaluate", () => {
  it("fires once then respects hysteresis / armed state", () => {
    const r = rule({ condition: { metric: "spot", operator: "gt", threshold: 99, underlying: "BTC" }, hysteresis: 2 });
    const first = evaluate(r, market({ spots: { BTC: 100 } }), portfolio());
    assert.equal(first.fired, true);
    assert.equal(first.next.armed, true);

    const stillHigh = evaluate({ ...r, ...first.next }, market({ spots: { BTC: 100 } }), portfolio());
    assert.equal(stillHigh.fired, false);

    const cleared = evaluate({ ...r, ...stillHigh.next }, market({ spots: { BTC: 96 } }), portfolio());
    assert.equal(cleared.next.armed, false);

    const refire = evaluate({ ...r, ...cleared.next, lastFiredAt: null }, market({ spots: { BTC: 100 } }), portfolio());
    assert.equal(refire.fired, true);
  });

  it("respects cooldown", () => {
    const now = Date.now();
    const r = rule({
      condition: { metric: "spot", operator: "gt", threshold: 50, underlying: "BTC" },
      cooldownMs: 60_000,
      lastFiredAt: new Date(now - 10_000).toISOString(),
      armed: false,
      hysteresis: 0,
    });
    const res = evaluate(r, market(), portfolio(), now);
    assert.equal(res.fired, false);
    assert.equal(res.reason, "cooldown");
  });

  it("does not fire on stale feed", () => {
    const r = rule({ condition: { metric: "spot", operator: "gt", threshold: 1, underlying: "BTC" } });
    const res = evaluate(r, market({ feedAgeMs: 60_000 }), portfolio());
    assert.equal(res.fired, false);
    assert.equal(res.reason, "stale_feed");
  });

  it("requires AND condition", () => {
    const r = rule({
      condition: { metric: "spot", operator: "gt", threshold: 90, underlying: "BTC" },
      and: { metric: "portfolio_delta", operator: "gt", threshold: 10 },
      hysteresis: 0,
    });
    const res = evaluate(r, market(), portfolio({ netDelta: 2 }));
    assert.equal(res.fired, false);
  });
});
