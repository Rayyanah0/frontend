/**
 * Unit tests for proposal submission: threshold checking, fee estimation and
 * argument construction.
 *
 * `submitProposal` itself is exercised with the Soroban pipeline mocked — the
 * SDK is stubbed globally under Jest, and the pipeline opens a real RPC
 * connection that must not be touched in a unit test.
 */

import {
  BASE_FEE_STROOPS,
  ESTIMATED_RESOURCE_FEE_STROOPS,
  STROOPS_PER_XLM,
  SUBMIT_PROPOSAL_METHOD,
  buildProposalArgs,
  checkThreshold,
  estimateFee,
} from "../submit";
import { emptyDraft, makeAction, type ProposalDraft } from "../draft";

const CONTRACT_A = "CBLY5XSJLCYNHLV7WTULBLSVX2XXAHNZACQYGGKNXAKCICWITZBKXRWY";
const CONTRACT_B = "CBBHHFC3EFY34FOJOBHR52V2BE6QPNCRHDK7UJS64YC2NNL4JIPNUOPR";
const ACCOUNT_A = "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4";

const CONTRACT_IDS = { market: CONTRACT_A, vault: CONTRACT_B };

function validDraft(over: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    ...emptyDraft(),
    title: "Raise the collateral ratio",
    summary: "Tighten risk",
    body: "A description that is comfortably longer than the minimum length required.",
    actions: [makeAction("market", "set_collateral_ratio", { ratio_bps: "12000" })],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// checkThreshold
// ---------------------------------------------------------------------------

describe("checkThreshold", () => {
  it("is eligible when power meets the proposal threshold", () => {
    const result = checkThreshold({
      votingPower: 1000n,
      threshold: 100n,
      proposalThreshold: 500n,
    });
    expect(result.eligible).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.message).toMatch(/meets/i);
  });

  it("is not eligible below the threshold", () => {
    const result = checkThreshold({
      votingPower: 10n,
      threshold: 100n,
      proposalThreshold: 500n,
    });
    expect(result.eligible).toBe(false);
    expect(result.progress).toBeCloseTo(0.02, 6);
    expect(result.message).toContain("GOV");
  });

  it("falls back to the base threshold when no proposal threshold is set", () => {
    const result = checkThreshold({ votingPower: 10n, threshold: 100n, proposalThreshold: 0n });
    expect(result.eligible).toBe(false);
    expect(result.message).toContain("90");
  });

  it("treats an unconfigured threshold as no bar rather than dividing by zero", () => {
    const result = checkThreshold({ votingPower: 5n, threshold: 0n, proposalThreshold: 0n });
    expect(result.eligible).toBe(true);
    expect(result.progress).toBe(1);
    expect(result.message).toMatch(/no proposal threshold/i);
  });

  it("uses a custom deposit token in the shortfall message", () => {
    const result = checkThreshold(
      { votingPower: 0n, threshold: 1_000_000_000n, proposalThreshold: 1_000_000_000n },
      "USDC"
    );
    expect(result.message).toContain("USDC");
    expect(result.message).toMatch(/1\.00B/);
  });

  it("formats shortfalls with K/M/B suffixes", () => {
    const k = checkThreshold({ votingPower: 0n, threshold: 5_000n, proposalThreshold: 5_000n });
    expect(k.message).toMatch(/5\.0K/);
    const m = checkThreshold({ votingPower: 0n, threshold: 2_500_000n, proposalThreshold: 2_500_000n });
    expect(m.message).toMatch(/2\.5M/);
  });
});

// ---------------------------------------------------------------------------
// estimateFee
// ---------------------------------------------------------------------------

describe("estimateFee", () => {
  it("estimates a standard-priority fee", () => {
    const fee = estimateFee("standard");
    expect(fee.totalStroops).toBe(BASE_FEE_STROOPS + ESTIMATED_RESOURCE_FEE_STROOPS);
    expect(fee.totalXlm).toBeCloseTo((BASE_FEE_STROOPS + ESTIMATED_RESOURCE_FEE_STROOPS) / STROOPS_PER_XLM, 10);
    expect(fee.priority).toBe("standard");
    expect(fee.estimated).toBe(true);
  });

  it("charges more for fast priority", () => {
    expect(estimateFee("fast").totalStroops).toBeGreaterThan(estimateFee("standard").totalStroops);
  });

  it("defaults to standard", () => {
    expect(estimateFee().priority).toBe("standard");
  });

  it("omits USD when no XLM price is known", () => {
    expect(estimateFee("standard", null).totalUsd).toBeNull();
  });

  it("converts to USD when a price is supplied", () => {
    const fee = estimateFee("standard", 0.1);
    expect(fee.totalUsd).toBeCloseTo(fee.totalXlm * 0.1, 12);
  });
});

// ---------------------------------------------------------------------------
// buildProposalArgs
// ---------------------------------------------------------------------------

describe("buildProposalArgs", () => {
  it("builds [title, summary, body, url, actions, proposer]", () => {
    const built = buildProposalArgs(validDraft(), CONTRACT_IDS, ACCOUNT_A);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.args).toHaveLength(6);
    expect(built.args[0]).toBe("Raise the collateral ratio");
    expect(built.args[1]).toBe("Tighten risk");
    expect(built.args[5]).toBe(ACCOUNT_A);
  });

  it("resolves each action to a concrete contract id", () => {
    const built = buildProposalArgs(validDraft(), CONTRACT_IDS, ACCOUNT_A);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.args[4]).toEqual([
      { contract: CONTRACT_A, function: "set_collateral_ratio", args: [12000n] },
    ]);
  });

  it("trims whitespace from text fields", () => {
    const built = buildProposalArgs(
      validDraft({ title: "  Padded title  ", summary: "  " }),
      CONTRACT_IDS,
      ACCOUNT_A
    );
    expect(built.ok).toBe(true);
    if (built.ok) expect(built.args[0]).toBe("Padded title");
  });

  it("keeps action order", () => {
    const built = buildProposalArgs(
      validDraft({
        actions: [
          makeAction("market", "set_fee_bps", { fee_bps: "75" }),
          makeAction("vault", "set_withdrawal_fee_bps", { fee_bps: "20" }),
        ],
      }),
      CONTRACT_IDS,
      ACCOUNT_A
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      const actions = built.args[4] as { function: string; contract: string; args: unknown[] }[];
      expect(actions.map((a) => a.function)).toEqual([
        "set_fee_bps",
        "set_withdrawal_fee_bps",
      ]);
      expect(actions[1].contract).toBe(CONTRACT_B);
    }
  });

  it("rejects a draft whose metadata is incomplete", () => {
    const built = buildProposalArgs(validDraft({ title: "" }), CONTRACT_IDS, ACCOUNT_A);
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/title/i);
  });

  it("rejects a draft with no actions", () => {
    const built = buildProposalArgs(validDraft({ actions: [] }), CONTRACT_IDS, ACCOUNT_A);
    expect(built.ok).toBe(false);
  });

  it("rejects an action whose arguments do not validate", () => {
    const built = buildProposalArgs(
      validDraft({ actions: [makeAction("market", "set_collateral_ratio", { ratio_bps: "abc" })] }),
      CONTRACT_IDS,
      ACCOUNT_A
    );
    expect(built.ok).toBe(false);
    if (!built.ok) expect(built.reason).toMatch(/ratio_bps/);
  });

  it("refuses to build when a contract id is not configured", () => {
    const built = buildProposalArgs(validDraft(), {}, ACCOUNT_A);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      // The message must tell the operator exactly which env var to set.
      expect(built.reason).toMatch(/No contract configured/i);
      expect(built.reason).toMatch(/NEXT_PUBLIC_CONTRACT_MARKET_/);
    }
  });

  it("rejects an unknown action", () => {
    const built = buildProposalArgs(
      validDraft({ actions: [{ id: "x", contractKey: "market", functionName: "nope", values: {} }] }),
      CONTRACT_IDS,
      ACCOUNT_A
    );
    expect(built.ok).toBe(false);
  });

  it("encodes every supported argument type", () => {
    const built = buildProposalArgs(
      validDraft({
        actions: [
          makeAction("oracle", "set_feeds", { operators: `${ACCOUNT_A}\n${ACCOUNT_A.slice(0, 0)}GBQ37LN4NVDK6ZCQC4Y6UFVP52XOAISX5UWYHYWKWXONXLT4WQ5E64U5` }),
        ],
      }),
      { oracle: CONTRACT_A },
      ACCOUNT_A
    );
    expect(built.ok).toBe(true);
    if (built.ok) {
      const actions = built.args[4] as { args: unknown[] }[];
      expect(actions[0].args[0]).toEqual([
        "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4",
        "GBQ37LN4NVDK6ZCQC4Y6UFVP52XOAISX5UWYHYWKWXONXLT4WQ5E64U5",
      ]);
    }
  });
});

describe("SUBMIT_PROPOSAL_METHOD", () => {
  it("matches the governor entry point name", () => {
    expect(SUBMIT_PROPOSAL_METHOD).toBe("submit_proposal");
  });
});

// ---------------------------------------------------------------------------
// submitProposal wiring
// ---------------------------------------------------------------------------

describe("submitProposal", () => {
  const executeMock = jest.fn();

  beforeEach(() => {
    executeMock.mockReset();
    jest.resetModules();
  });

  /** Import a fresh copy of the module with the pipeline stubbed out. */
  async function loadSubmit() {
    jest.doMock("../../soroban/pipeline", () => ({
      executeContractCall: executeMock,
      newTxId: () => "tx-test",
    }));
    jest.doMock("../../store/tracker", () => ({
      createPipelineEventHandler: jest.fn(() => jest.fn()),
    }));
    return import("../submit");
  }

  function signer() {
    return {
      address: ACCOUNT_A,
      networkPassphrase: "Test SDF Network ; September 2015",
      signTransaction: jest.fn(),
      signMessage: jest.fn(),
      canSignMessages: true,
    };
  }

  it("refuses to submit without a governor contract", async () => {
    const { submitProposal } = await loadSubmit();
    await expect(
      submitProposal(
        {
          draft: validDraft(),
          contractIds: CONTRACT_IDS,
          governorContractId: null,
          proposer: ACCOUNT_A,
          signer: signer(),
        },
        jest.fn()
      )
    ).rejects.toThrow(/Governor contract is not configured/);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("routes the call through executeContractCall", async () => {
    const { submitProposal } = await loadSubmit();
    executeMock.mockResolvedValue({ txId: "tx-test", hash: "abc" });

    await submitProposal(
      {
        draft: validDraft(),
        contractIds: CONTRACT_IDS,
        governorContractId: CONTRACT_B,
        proposer: ACCOUNT_A,
        signer: signer(),
      },
      jest.fn()
    );

    expect(executeMock).toHaveBeenCalledTimes(1);
    const params = executeMock.mock.calls[0][0];
    expect(params.contract).toBe(CONTRACT_B);
    expect(params.method).toBe("submit_proposal");
    expect(params.args[0]).toBe("Raise the collateral ratio");
  });

  it("serialises bigints into the retry params", async () => {
    const { createPipelineEventHandler } = jest.requireMock("../../store/tracker");
    const { submitProposal } = await loadSubmit();
    executeMock.mockResolvedValue({});

    await submitProposal(
      {
        draft: validDraft(),
        contractIds: CONTRACT_IDS,
        governorContractId: CONTRACT_B,
        proposer: ACCOUNT_A,
        signer: signer(),
      },
      jest.fn()
    );

    const retryParams = createPipelineEventHandler.mock.calls[0][2];
    expect(retryParams.method).toBe("submit_proposal");
    // JSON must round-trip without a BigInt TypeError.
    expect(() => JSON.parse(retryParams.argsJson)).not.toThrow();
    expect(retryParams.argsJson).toContain("12000");
    expect(retryParams.argsJson).not.toContain('"12000n"');
  });

  it("forwards pipeline events to both the tracker and the caller", async () => {
    const { submitProposal } = await loadSubmit();
    executeMock.mockImplementation(async (_params: unknown, onEvent: (e: unknown) => void) => {
      onEvent({ txId: "tx-test", stage: "simulating", elapsedMs: 1 });
      onEvent({ txId: "tx-test", stage: "success", elapsedMs: 2, hash: "abc" });
      return { txId: "tx-test", hash: "abc" };
    });

    const onEvent = jest.fn();
    await submitProposal(
      {
        draft: validDraft(),
        contractIds: CONTRACT_IDS,
        governorContractId: CONTRACT_B,
        proposer: ACCOUNT_A,
        signer: signer(),
      },
      onEvent
    );

    expect(onEvent).toHaveBeenCalledTimes(2);
    expect(onEvent.mock.calls[1][0].stage).toBe("success");
  });

  it("propagates validation failures as a thrown error before hitting the network", async () => {
    const { submitProposal } = await loadSubmit();
    await expect(
      submitProposal(
        {
          draft: validDraft({ title: "" }),
          contractIds: CONTRACT_IDS,
          governorContractId: CONTRACT_B,
          proposer: ACCOUNT_A,
          signer: signer(),
        },
        jest.fn()
      )
    ).rejects.toThrow(/title/i);
    expect(executeMock).not.toHaveBeenCalled();
  });
});
