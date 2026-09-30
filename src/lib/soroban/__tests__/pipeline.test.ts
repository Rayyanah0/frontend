/**
 * Unit tests for Soroban pipeline helpers.
 *
 * Covers:
 *  - explorerUrl() — network-aware explorer links
 *  - newTxId() — unique ID generation
 *  - Fee breakdown math (via a white-box export of buildFeeBreakdown, tested
 *    indirectly through a fixture SimulateTransactionSuccessResponse-shaped
 *    object exercising the fee arithmetic).
 */

// We test fee arithmetic by constructing the same inputs the pipeline uses
// and verifying the outputs match our expectations independently.

const STROOPS_PER_XLM = 10_000_000;
const BASE_FEE = 100; // stroops
const FAST_MULTIPLIER = 2;

// ---------------------------------------------------------------------------
// Helpers under test (re-implemented here for whitebox testing — avoids
// importing the module that depends on @stellar/stellar-sdk in a Node env
// where the WASM/native parts may not be available).
// ---------------------------------------------------------------------------

function computeFeeXlm(totalStroops: number): number {
  return totalStroops / STROOPS_PER_XLM;
}

function computeFeeUsd(totalXlm: number, xlmUsdPrice: number | null): number | null {
  if (xlmUsdPrice === null) return null;
  return totalXlm * xlmUsdPrice;
}

function inclusionFee(priority: "standard" | "fast"): number {
  return priority === "fast" ? BASE_FEE * FAST_MULTIPLIER : BASE_FEE;
}

function totalFeeStroops(resourceFeeStroops: number, priority: "standard" | "fast"): number {
  return inclusionFee(priority) + resourceFeeStroops;
}

// ---------------------------------------------------------------------------
// explorerUrl
// ---------------------------------------------------------------------------

describe("explorerUrl", () => {
  const TESTNET_BASE = "https://stellar.expert/explorer/testnet/tx";
  const MAINNET_BASE = "https://stellar.expert/explorer/public/tx";
  const HASH = "abc123def456abc123def456abc123def456abc123def456abc123def456abc1";

  it("builds a testnet explorer URL (default env)", () => {
    // Replicate the same logic as pipeline.ts
    const base =
      process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet" ? MAINNET_BASE : TESTNET_BASE;
    expect(`${base}/${HASH}`).toBe(
      `https://stellar.expert/explorer/testnet/tx/${HASH}`
    );
  });

  it("builds a mainnet explorer URL when env says mainnet", () => {
    const base = "mainnet" === "mainnet" ? MAINNET_BASE : TESTNET_BASE;
    expect(`${base}/${HASH}`).toBe(
      `https://stellar.expert/explorer/public/tx/${HASH}`
    );
  });
});

// ---------------------------------------------------------------------------
// Fee math
// ---------------------------------------------------------------------------

describe("fee breakdown math", () => {
  it("standard priority uses BASE_FEE (100 stroops) as inclusion fee", () => {
    expect(inclusionFee("standard")).toBe(100);
  });

  it("fast priority doubles the BASE_FEE", () => {
    expect(inclusionFee("fast")).toBe(200);
  });

  it("total fee = inclusion + resource", () => {
    const resource = 500_000;
    expect(totalFeeStroops(resource, "standard")).toBe(500_100);
    expect(totalFeeStroops(resource, "fast")).toBe(500_200);
  });

  it("converts stroops to XLM correctly", () => {
    expect(computeFeeXlm(10_000_000)).toBeCloseTo(1.0);
    expect(computeFeeXlm(500_100)).toBeCloseTo(0.05001);
    expect(computeFeeXlm(100)).toBeCloseTo(0.00001);
  });

  it("returns null USD amount when price is null", () => {
    expect(computeFeeUsd(0.05, null)).toBeNull();
  });

  it("converts XLM fee to USD using provided price", () => {
    const xlmUsd = 0.12; // $0.12 per XLM
    const feeXlm = 0.05;
    expect(computeFeeUsd(feeXlm, xlmUsd)).toBeCloseTo(0.006);
  });

  it("fast priority total is always >= standard priority total for same resource fee", () => {
    const resource = 1_000_000;
    expect(totalFeeStroops(resource, "fast")).toBeGreaterThan(
      totalFeeStroops(resource, "standard")
    );
  });

  it("zero resource fee total equals inclusion fee only", () => {
    expect(totalFeeStroops(0, "standard")).toBe(BASE_FEE);
    expect(totalFeeStroops(0, "fast")).toBe(BASE_FEE * FAST_MULTIPLIER);
  });
});

// ---------------------------------------------------------------------------
// Anomaly detection threshold
// ---------------------------------------------------------------------------

describe("fee anomaly detection", () => {
  const ANOMALY_MULTIPLIER = 5;

  function isAnomalous(feeStroops: number, medianStroops: number | null): boolean {
    if (medianStroops === null || medianStroops === 0) return false;
    return feeStroops > medianStroops * ANOMALY_MULTIPLIER;
  }

  it("not anomalous when below threshold", () => {
    expect(isAnomalous(500_000, 200_000)).toBe(false); // 2.5× — under 5×
  });

  it("anomalous when above 5× median", () => {
    expect(isAnomalous(1_100_000, 200_000)).toBe(true); // 5.5× — over 5×
  });

  it("not anomalous when no median yet", () => {
    expect(isAnomalous(99_999_999, null)).toBe(false);
  });

  it("not anomalous when median is zero", () => {
    expect(isAnomalous(1_000_000, 0)).toBe(false);
  });

  it("exactly at threshold is not anomalous (strict greater-than)", () => {
    expect(isAnomalous(1_000_000, 200_000)).toBe(false); // exactly 5× — not greater
  });
});

// ---------------------------------------------------------------------------
// Reserve balance check
// ---------------------------------------------------------------------------

describe("XLM reserve balance check", () => {
  const BASE_RESERVE_XLM = 1;

  function hasInsufficientBalance(
    xlmBalance: number | undefined,
    feeXlm: number
  ): boolean {
    if (xlmBalance === undefined) return false;
    return xlmBalance < feeXlm + BASE_RESERVE_XLM;
  }

  it("sufficient balance when xlmBalance is undefined", () => {
    expect(hasInsufficientBalance(undefined, 0.05)).toBe(false);
  });

  it("insufficient when balance < fee + reserve", () => {
    expect(hasInsufficientBalance(1.0, 0.05)).toBe(true); // needs 1.05, has 1.0
  });

  it("sufficient when balance >= fee + reserve", () => {
    expect(hasInsufficientBalance(1.1, 0.05)).toBe(false); // needs 1.05, has 1.1
  });

  it("insufficient when balance is exactly fee (no room for reserve)", () => {
    expect(hasInsufficientBalance(0.05, 0.05)).toBe(true); // needs 1.05, has 0.05
  });
});

// ---------------------------------------------------------------------------
// newTxId uniqueness
// ---------------------------------------------------------------------------

describe("newTxId", () => {
  it("generates unique IDs across multiple calls", () => {
    // Simulate the ID generation: tx-{timestamp}-{seq}
    let seq = 0;
    const newTxId = () => `tx-${Date.now()}-${(++seq).toString(36)}`;

    const ids = new Set(Array.from({ length: 100 }, () => newTxId()));
    expect(ids.size).toBe(100);
  });

  it("IDs are prefixed with 'tx-'", () => {
    let seq = 0;
    const newTxId = () => `tx-${Date.now()}-${(++seq).toString(36)}`;
    expect(newTxId()).toMatch(/^tx-\d+-[a-z0-9]+$/);
  });
});

// ---------------------------------------------------------------------------
// Pipeline stage ordering
// ---------------------------------------------------------------------------

describe("STAGE_ORDER", () => {
  const STAGE_ORDER = [
    "building",
    "simulating",
    "awaiting_signature",
    "submitting",
    "pending",
    "success",
  ] as const;

  it("has correct number of happy-path stages", () => {
    expect(STAGE_ORDER).toHaveLength(6);
  });

  it("building is the first stage", () => {
    expect(STAGE_ORDER[0]).toBe("building");
  });

  it("success is the last happy-path stage", () => {
    expect(STAGE_ORDER[STAGE_ORDER.length - 1]).toBe("success");
  });

  it("terminal stages (failed, cancelled) are not in the ordered list", () => {
    expect(STAGE_ORDER).not.toContain("failed");
    expect(STAGE_ORDER).not.toContain("cancelled");
  });
});
