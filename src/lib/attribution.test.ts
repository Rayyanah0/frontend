import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { attribute, attributePosition, type PositionSnapshot } from "./attribution.ts";

function snap(partial: Partial<PositionSnapshot> & Pick<PositionSnapshot, "id">): PositionSnapshot {
  return {
    underlying: "BTC",
    option_type: "call",
    position_type: "long",
    strike: 100,
    contracts: 1,
    premium: 10,
    spot: 100,
    iv: 0.5,
    delta: 1,
    gamma: 0,
    theta: 0,
    vega: 0,
    ...partial,
  };
}

describe("attributePosition", () => {
  it("attributes 100% of P&L to delta on a delta-1 spot move", () => {
    const before = snap({ id: "1", premium: 50, spot: 100, delta: 1, gamma: 0, theta: 0, vega: 0 });
    const after = snap({ id: "1", premium: 55, spot: 105, delta: 1, gamma: 0, theta: 0, vega: 0 });
    const row = attributePosition(before, after, 0)!;
    assert.ok(Math.abs(row.delta - 5) < 1e-6);
    assert.ok(Math.abs(row.totalPnl - 5) < 1e-6);
    assert.ok(Math.abs(Math.abs(row.delta / row.totalPnl) - 1) < 1e-5);
    assert.ok(Math.abs(row.delta + row.gamma + row.theta + row.vega + row.residual - row.totalPnl) < 1e-8);
  });

  it("sums components + residual to total P&L", () => {
    const before = snap({
      id: "2",
      premium: 8,
      spot: 100,
      iv: 0.5,
      delta: 0.4,
      gamma: 0.02,
      theta: -0.05,
      vega: 0.12,
    });
    const after = snap({
      id: "2",
      premium: 9.5,
      spot: 103,
      iv: 0.55,
      delta: 0.45,
      gamma: 0.02,
      theta: -0.05,
      vega: 0.12,
    });
    const row = attributePosition(before, after, 1)!;
    assert.ok(Math.abs(row.delta + row.gamma + row.theta + row.vega + row.residual - row.totalPnl) < 1e-10);
  });

  it("flags model error when residual exceeds 10%", () => {
    const before = snap({ id: "3", premium: 10, spot: 100, delta: 0.01, gamma: 0, theta: 0, vega: 0 });
    const after = snap({ id: "3", premium: 20, spot: 101, delta: 0.01, gamma: 0, theta: 0, vega: 0 });
    const row = attributePosition(before, after, 0)!;
    assert.equal(row.modelError, true);
  });

  it("handles short positions with inverted sign", () => {
    const before = snap({ id: "4", position_type: "short", premium: 10, spot: 100, delta: 0.5 });
    const after = snap({ id: "4", position_type: "short", premium: 12, spot: 104, delta: 0.5 });
    const row = attributePosition(before, after, 0)!;
    assert.ok(Math.abs(row.totalPnl - -2) < 1e-6);
    assert.ok(Math.abs(row.delta + row.gamma + row.theta + row.vega + row.residual - row.totalPnl) < 1e-10);
  });
});

describe("attribute aggregate", () => {
  it("builds a waterfall ending at total P&L", () => {
    const before = [snap({ id: "a", premium: 10, spot: 100, delta: 1 })];
    const after = [snap({ id: "a", premium: 12, spot: 102, delta: 1 })];
    const agg = attribute(before, after, 0);
    assert.equal(agg.waterfall[0].label, "Baseline");
    assert.equal(agg.waterfall[agg.waterfall.length - 1].label, "Current");
    assert.ok(Math.abs(agg.waterfall[agg.waterfall.length - 1].cumulative - agg.totalPnl) < 1e-8);
    assert.ok(Math.abs(agg.delta + agg.gamma + agg.theta + agg.vega + agg.residual - agg.totalPnl) < 1e-10);
  });
});
