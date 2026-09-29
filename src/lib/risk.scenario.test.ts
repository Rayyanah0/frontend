import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scenarioGrid, scenarioPositionPnl, defaultScenarioAxis } from "./risk";
import type { Position } from "./api/types";
import { bs, smileVol } from "./pricing";

function makePos(over: Partial<Position> = {}): Position {
  return {
    id: "p1",
    wallet_address: "G...",
    underlying: "XLM",
    strike: 0.12,
    expiry_days: 30,
    option_type: "call",
    position_type: "long",
    contracts: 1,
    entry_premium: 0.01,
    entry_spot: 0.118,
    collateral: 0,
    status: "open",
    close_premium: null,
    close_spot: null,
    realized_pnl: null,
    opened_at: new Date().toISOString(),
    closed_at: null,
    strategy_id: null,
    ...over,
  };
}

describe("scenarioGrid", () => {
  const spot = 0.1182;
  const vol = 0.82;

  it("zero shock equals current mark-to-model P&L", () => {
    const pos = makePos();
    const t = pos.expiry_days / 365;
    const g = bs(spot, pos.strike, smileVol(vol, pos.strike / spot), t, true);
    const expected = g.premium * pos.contracts - pos.entry_premium * pos.contracts;
    const pnl = scenarioPositionPnl(pos, spot, vol, 0, 0, 0);
    assert.ok(Math.abs(pnl - expected) < 1e-8);
  });

  it("long call gains on positive spot shock", () => {
    const pos = makePos({ position_type: "long", option_type: "call" });
    const up = scenarioPositionPnl(pos, spot, vol, 0.2, 0, 0);
    const down = scenarioPositionPnl(pos, spot, vol, -0.2, 0, 0);
    assert.ok(up > down);
  });

  it("short call loses on positive spot shock", () => {
    const pos = makePos({ position_type: "short", option_type: "call", entry_premium: 0.02 });
    const up = scenarioPositionPnl(pos, spot, vol, 0.2, 0, 0);
    const flat = scenarioPositionPnl(pos, spot, vol, 0, 0, 0);
    assert.ok(up < flat);
  });

  it("clamps negative vol after shock", () => {
    assert.doesNotThrow(() => scenarioPositionPnl(makePos(), spot, 0.5, 0, -0.99, 0));
  });

  it("missing spot yields 0 for that position", () => {
    assert.equal(scenarioPositionPnl(makePos(), 0, vol, 0.1, 0, 0), 0);
  });

  it("15×15 grid over many positions finishes under 300ms", () => {
    const positions = Array.from({ length: 200 }, (_, i) =>
      makePos({
        id: `p${i}`,
        underlying: i % 2 === 0 ? "XLM" : "BTC",
        strike: 0.1 + (i % 20) * 0.01,
        option_type: i % 2 === 0 ? "call" : "put",
        position_type: i % 3 === 0 ? "short" : "long",
      })
    );
    const axis = defaultScenarioAxis(1);
    assert.equal(axis.spotShocks.length, 15);
    assert.equal(axis.ivShocks.length, 15);
    const result = scenarioGrid(
      positions,
      { XLM: 0.118, BTC: 67000 },
      { XLM: 0.8, BTC: 0.6 },
      axis
    );
    assert.equal(result.cells.length, 225);
    assert.ok(result.elapsedMs < 300, `took ${result.elapsedMs}ms`);
    console.log(`scenarioGrid benchmark: ${result.elapsedMs.toFixed(2)}ms for 200 pos × 15×15`);
  });
});
