/**
 * Unit tests for the simulation preview: current-value reads, the
 * current → proposed diff, and aggregation across a draft's actions.
 */

import { diffParam, formatDiffRow, simulateActions } from "../simulation";
import type { ValueReader } from "../simulation";
import { formatParamValue, type ActionParamSpec } from "../actions";
import type { ProposalAction } from "../actions";

const ACCOUNT_A = "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4";
const CONTRACT_A = "CBLY5XSJLCYNHLV7WTULBLSVX2XXAHNZACQYGGKNXAKCICWITZBKXRWY";

const BPS: ActionParamSpec = {
  name: "ratio_bps",
  label: "Collateral ratio",
  type: "u32",
  display: "bps",
  decimals: 0,
  unit: "%",
};

const XLM_SPEC: ActionParamSpec = {
  name: "min_deposit",
  label: "Minimum deposit",
  type: "i128",
  display: "xlm",
  decimals: 7,
  unit: "XLM",
};

function action(over: Partial<ProposalAction> = {}): ProposalAction {
  return {
    id: "a1",
    contractKey: "market",
    functionName: "set_collateral_ratio",
    values: { ratio_bps: "12000" },
    ...over,
  };
}

/** Reader that answers by method name, defaulting to null (unknown). */
function readerFor(values: Record<string, string>): ValueReader {
  return async ({ readMethod }) => values[readMethod] ?? null;
}

// ---------------------------------------------------------------------------
// diffParam
// ---------------------------------------------------------------------------

describe("diffParam", () => {
  it("produces the current → proposed pair with the right direction", () => {
    const diff = diffParam(BPS, "110%", "120%");
    expect(diff).toMatchObject({
      paramName: "ratio_bps",
      label: "Collateral ratio",
      current: "110%",
      proposed: "120%",
      direction: "up",
      unit: "%",
    });
  });

  it("computes an absolute delta in native units, not percent-of-percent", () => {
    const diff = diffParam(BPS, "110%", "120%");
    expect(diff.delta).toBe(1000);
    expect(diff.percentChange).toBeCloseTo((1000 / 11000) * 100, 6);
  });

  it("detects a decrease", () => {
    const diff = diffParam(BPS, "130%", "110%");
    expect(diff.direction).toBe("down");
    expect(diff.delta).toBe(-2000);
  });

  it("detects no change", () => {
    const diff = diffParam(BPS, "110%", "110%");
    expect(diff.direction).toBe("same");
    expect(diff.delta).toBe(0);
  });

  it("handles an unknown current value", () => {
    const diff = diffParam(BPS, null, "120%");
    expect(diff.current).toBeNull();
    expect(diff.direction).toBe("unknown");
    expect(diff.delta).toBeNull();
    expect(diff.percentChange).toBeNull();
  });

  it("does not divide by a zero base", () => {
    const diff = diffParam(BPS, "0%", "120%");
    expect(diff.delta).toBe(12000);
    expect(diff.percentChange).toBeNull();
  });

  it("computes deltas for non-numeric displays without NaN", () => {
    const addr: ActionParamSpec = { name: "admin", label: "Admin", type: "address", display: "address" };
    const diff = diffParam(addr, "GAZW5D…W5D4", "GBQ37L…5E5U");
    expect(Number.isNaN(diff.delta as number)).toBe(false);
  });
});

describe("formatDiffRow", () => {
  it("renders the arrow with a placeholder for unknown values", () => {
    expect(formatDiffRow(diffParam(BPS, "110%", "120%"))).toBe(
      "Collateral ratio: 110% → 120%"
    );
    expect(formatDiffRow(diffParam(BPS, null, "120%"))).toBe(
      "Collateral ratio: ? → 120%"
    );
  });
});

// ---------------------------------------------------------------------------
// simulateActions
// ---------------------------------------------------------------------------

describe("simulateActions", () => {
  it("reads the current value and renders the diff", async () => {
    const result = await simulateActions([action()], {
      reader: readerFor({ collateral_ratio: "11000" }),
      contractIds: { market: CONTRACT_A },
    });

    expect(result.simulations).toHaveLength(1);
    const sim = result.simulations[0];
    expect(sim.contractLabel).toBe("Market");
    expect(sim.functionLabel).toBe("Put collateral ratio");
    expect(sim.diffs).toHaveLength(1);
    expect(sim.diffs[0].current).toBe("110%");
    expect(sim.diffs[0].proposed).toBe("120%");
    expect(sim.diffs[0].direction).toBe("up");
    expect(sim.partial).toBe(false);
  });

  it("marks the simulation partial when the read fails", async () => {
    const result = await simulateActions([action()], { reader: readerFor({}) });
    expect(result.simulations[0].partial).toBe(true);
    expect(result.simulations[0].diffs[0].current).toBeNull();
  });

  it("marks the simulation partial when the reader throws", async () => {
    const result = await simulateActions([action()], {
      reader: async () => {
        throw new Error("rpc down");
      },
    });
    expect(result.simulations[0].partial).toBe(true);
  });

  it("passes the contract id through to the reader", async () => {
    const seen: string[] = [];
    await simulateActions([action()], {
      contractIds: { market: CONTRACT_A },
      reader: async ({ contractId }) => {
        seen.push(String(contractId));
        return "11000";
      },
    });
    expect(seen).toEqual([CONTRACT_A]);
  });

  it("reports an unknown contract id as a null contractId", async () => {
    let received: string | null | undefined;
    await simulateActions([action()], {
      contractIds: {},
      reader: async ({ contractId }) => {
        received = contractId;
        return "11000";
      },
    });
    expect(received).toBeNull();
  });

  it("surfaces encoding errors without throwing", async () => {
    const result = await simulateActions([action({ values: { ratio_bps: "abc" } })]);
    expect(result.hasErrors).toBe(true);
    expect(result.simulations[0].errors[0].paramName).toBe("ratio_bps");
    // A field that failed validation contributes no diff row.
    expect(result.simulations[0].diffs).toHaveLength(0);
  });

  it("handles an unknown action without throwing", async () => {
    const result = await simulateActions([action({ functionName: "nope" })]);
    expect(result.simulations[0].summary).toBe("Unknown action");
    expect(result.hasErrors).toBe(true);
  });

  it("flags dangerous actions", async () => {
    const result = await simulateActions([
      action({
        contractKey: "deployer",
        functionName: "upgrade_contract",
        values: { contract: CONTRACT_A, wasm_hash: "0xabc" },
      }),
    ]);
    expect(result.hasDangerous).toBe(true);
    expect(result.simulations[0].dangerous).toBe(true);
  });

  it("does not flag routine actions", async () => {
    const result = await simulateActions([action()]);
    expect(result.hasDangerous).toBe(false);
  });

  it("handles boolean params", async () => {
    const result = await simulateActions(
      [action({ functionName: "set_paused", values: { paused: "true" } })],
      { reader: readerFor({ paused: "false" }) }
    );
    expect(result.simulations[0].diffs[0]).toMatchObject({
      current: "false",
      proposed: "true",
      direction: "unknown", // booleans are not numeric
    });
  });

  it("simulates multiple actions concurrently", async () => {
    const result = await simulateActions(
      [
        action({ id: "a1" }),
        action({ id: "a2", contractKey: "vault", functionName: "set_withdrawal_fee_bps", values: { fee_bps: "20" } }),
      ],
      { reader: readerFor({ collateral_ratio: "11000", withdrawal_fee_bps: "10" }) }
    );
    expect(result.simulations).toHaveLength(2);
    expect(result.simulations.map((s) => s.actionId)).toEqual(["a1", "a2"]);
    expect(result.simulations[1].diffs[0]).toMatchObject({ current: "0.10%", proposed: "0.20%" });
  });

  it("enforces the per-proposal action limit", async () => {
    const many = Array.from({ length: 9 }, (_, i) => action({ id: `a${i}` }));
    const ok = await simulateActions(many, { maxActions: 8 });
    expect(ok.withinActionLimit).toBe(false);

    const fine = await simulateActions(many.slice(0, 8), { maxActions: 8 });
    expect(fine.withinActionLimit).toBe(true);
  });

  it("returns an empty result for no actions", async () => {
    const result = await simulateActions([]);
    expect(result.simulations).toEqual([]);
    expect(result.hasErrors).toBe(false);
    expect(result.hasDangerous).toBe(false);
  });

  it("preserves i128 magnitudes coming back from the chain", async () => {
    const maxI128 = "170141183460469231731687303715884105727";
    const result = await simulateActions(
      [action({ contractKey: "vault", functionName: "set_min_deposit_xlm", values: { min_deposit: "20000000000" } })],
      { reader: readerFor({ min_deposit: maxI128 }) }
    );
    // Every digit must survive — no exponent notation, no double rounding.
    expect(result.simulations[0].diffs[0].current).toBe(
      "17014118346046923173168730371588.4105727 XLM"
    );
    expect(result.simulations[0].diffs[0].current).not.toMatch(/e\+/i);
  });

  it("builds a readable summary line", async () => {
    const result = await simulateActions([action()], { reader: readerFor({ collateral_ratio: "11000" }) });
    expect(result.simulations[0].summary).toBe("Put collateral ratio → Collateral ratio 120%");
  });
});

// ---------------------------------------------------------------------------
// The reader's raw values agree with the encoder
// ---------------------------------------------------------------------------

describe("read values and encoded values share a formatting path", () => {
  it("uses the same formatter on both sides of the arrow", () => {
    // A reader returning the raw on-chain value and a user-typed value must
    // produce comparable output, otherwise every diff reads as a total change.
    const current = "11000";
    const proposed = "12000";
    const asBps = (raw: string) => formatParamValue(BPS, BigInt(raw));
    const diff = diffParam(BPS, asBps(current), asBps(proposed));
    expect(diff.current).toBe("110%");
    expect(diff.proposed).toBe("120%");
    expect(diff.delta).toBe(1000);
  });

  it("keeps full i128 precision in the formatted diff", () => {
    const maxI128 = "170141183460469231731687303715884105727";
    const asXlm = (raw: string) => formatParamValue(XLM_SPEC, BigInt(raw));
    const diff = diffParam(XLM_SPEC, asXlm(maxI128), asXlm("20000000000"));
    expect(diff.current).not.toMatch(/e\+/i);
    expect(diff.current).toMatch(/^17014118346046923173168730371588\./);
  });
});
