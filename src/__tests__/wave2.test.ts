import { describe, it, expect } from "vitest";
import { runBatchClose } from "../lib/close/batchExecutor";
import { previewPartialClosePnl, clampCloseQty, aggregateClosePreview } from "../lib/close/partialPnl";
import { filterStrikeWindow, findAtmIndex, groupPositionsByStrategy } from "../features/chain/chainUtils";
import { migrateLayout, PRESET_TRADER, LAYOUT_VERSION } from "../features/workspace/layouts";
import { fuzzyScore, searchCommands, type Command } from "../components/command/registry";
import { isEditableTarget, matchBinding } from "../components/command/hotkeys";

describe("partial close P&L", () => {
  it("scales long P&L by closed quantity", () => {
    const r = previewPartialClosePnl(
      { contracts: 10, entry_premium: 1, position_type: "long" },
      1.5,
      4
    );
    expect(r.closedQty).toBe(4);
    expect(r.realizedPnl).toBeCloseTo(2); // (1.5-1)*4
    expect(r.remaining).toBe(6);
  });

  it("scales short P&L when mark drops", () => {
    const r = previewPartialClosePnl(
      { contracts: 5, entry_premium: 2, position_type: "short" },
      1,
      2
    );
    expect(r.realizedPnl).toBeCloseTo(2); // (2-1)*2
  });

  it("clamps quantity to available with step", () => {
    expect(clampCloseQty(100, 3)).toBe(3);
    expect(clampCloseQty(0, 3)).toBe(0.01);
  });
});

describe("batch executor", () => {
  it("reports partial failure mid-batch and continues", async () => {
    const runs: string[] = [];
    const result = await runBatchClose(
      [
        { id: "a", label: "a", run: async () => { runs.push("a"); } },
        { id: "b", label: "b", run: async () => { runs.push("b"); throw new Error("boom"); } },
        { id: "c", label: "c", run: async () => { runs.push("c"); } },
      ],
      { mode: "continue" }
    );
    expect(runs).toEqual(["a", "b", "c"]);
    expect(result.okCount).toBe(2);
    expect(result.failCount).toBe(1);
    expect(result.items[1].status).toBe("failed");
  });

  it("stops on first failure when mode=stop", async () => {
    const runs: string[] = [];
    const result = await runBatchClose(
      [
        { id: "a", label: "a", run: async () => { runs.push("a"); throw new Error("x"); } },
        { id: "b", label: "b", run: async () => { runs.push("b"); } },
      ],
      { mode: "stop" }
    );
    expect(runs).toEqual(["a"]);
    expect(result.stoppedEarly).toBe(true);
    expect(result.items[1].status).toBe("skipped");
  });
});

describe("chain strike window", () => {
  const rows = Array.from({ length: 11 }, (_, i) => {
    const strike = 100 + (i - 5) * 5;
    return {
      strike,
      call: { delta: 0.5 - i * 0.05 },
      put: { delta: -0.5 + i * 0.05 },
      itmCall: strike < 100,
    };
  });

  it("finds ATM as first OTM call", () => {
    expect(findAtmIndex(rows)).toBe(5);
  });

  it("filters ±N around ATM", () => {
    const filtered = filterStrikeWindow(rows, { type: "atm", n: 2 });
    expect(filtered).toHaveLength(5);
    expect(findAtmIndex(filtered)).toBe(2);
  });

  it("filters by delta range", () => {
    const filtered = filterStrikeWindow(rows, { type: "delta", min: 0.2, max: 0.35, side: "call" });
    expect(filtered.every(r => Math.abs(r.call.delta) >= 0.2 && Math.abs(r.call.delta) <= 0.35)).toBe(true);
  });
});

describe("strategy grouping", () => {
  it("groups by strategy_id", () => {
    const { groups, solos } = groupPositionsByStrategy([
      { id: "1", strategy_id: "s1" },
      { id: "2", strategy_id: "s1" },
      { id: "3", strategy_id: null },
    ] as never);
    expect(groups).toHaveLength(1);
    expect(groups[0].legs).toHaveLength(2);
    expect(solos).toHaveLength(1);
  });
});

describe("workspace layout migration", () => {
  it("migrates v1 layouts and drops unknown panels", () => {
    const migrated = migrateLayout({
      version: 1,
      name: "Custom",
      panels: [
        { i: "chain", x: 0, y: 0, w: 6, h: 4 },
        { i: "ghost" as never, x: 0, y: 0, w: 1, h: 1 },
      ],
      hidden: ["ticket", "nope" as never],
    });
    expect(migrated?.version).toBe(LAYOUT_VERSION);
    expect(migrated?.panels).toHaveLength(1);
    expect(migrated?.panels[0].minW).toBe(2);
    expect(migrated?.hidden).toEqual(["ticket"]);
  });

  it("serializes preset round-trip via migrate", () => {
    const again = migrateLayout(JSON.parse(JSON.stringify(PRESET_TRADER)));
    expect(again?.name).toBe("Trader");
    expect(again?.panels.length).toBeGreaterThan(0);
  });
});

describe("command registry fuzzy search", () => {
  const cmds: Command[] = [
    { id: "1", label: "Go to Portfolio", keywords: ["go portfolio"], safe: true, run: () => undefined },
    { id: "2", label: "BTC 30D", keywords: ["btc", "30d"], safe: true, run: () => undefined },
    { id: "3", label: "Buy call on focused strike", keywords: ["buy call"], safe: true, run: () => undefined },
  ];

  it("scores subsequence matches", () => {
    expect(fuzzyScore("btc", "BTC 30D")).toBeGreaterThan(0);
    expect(fuzzyScore("zzz", "BTC 30D")).toBe(0);
  });

  it("ranks buy call above unrelated", () => {
    const hits = searchCommands("buy call", cmds);
    expect(hits[0].id).toBe("3");
  });
});

describe("hotkeys", () => {
  it("suppresses when target is an input", () => {
    const input = document.createElement("input");
    expect(isEditableTarget(input)).toBe(true);
    expect(isEditableTarget(document.createElement("div"))).toBe(false);
  });

  it("matches bindings on event.key", () => {
    const e = new KeyboardEvent("keydown", { key: "k", metaKey: true });
    expect(matchBinding(e, { action: "palette", key: "k", meta: true })).toBe(true);
    expect(matchBinding(e, { action: "palette", key: "k", ctrl: true })).toBe(false);
  });
});

describe("aggregate close preview", () => {
  it("sums premium pnl collateral", () => {
    const a = aggregateClosePreview([
      { entryPremiumTotal: 10, currentPremium: 12, pnl: 2, collateral: 100 },
      { entryPremiumTotal: 5, currentPremium: 3, pnl: -2, collateral: 50 },
    ]);
    expect(a.count).toBe(2);
    expect(a.totalPremium).toBe(15);
    expect(a.realizedPnl).toBe(0);
    expect(a.collateralReleased).toBe(150);
  });
});
