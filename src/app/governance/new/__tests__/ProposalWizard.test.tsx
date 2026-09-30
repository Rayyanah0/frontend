/**
 * RTL tests for the four-step proposal wizard (issue #89).
 *
 * Covers the full happy path plus the safety rails:
 *  - step gating (details -> actions -> simulate -> review)
 *  - live Markdown preview, including refusing unsafe link schemes
 *  - schema-driven action form and human-readable summary
 *  - simulation current -> proposed diffs
 *  - threshold gate, dangerous-action acknowledgement, fee display
 *  - draft autosave and restore
 *  - submission through the Soroban pipeline
 */

import React from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

const mockSubmitProposal = jest.fn();
const mockExecuteContractCall = jest.fn();

jest.mock("../../../../lib/governance/submit", () => {
  const actual = jest.requireActual("../../../../lib/governance/submit");
  return {
    ...actual,
    submitProposal: (...args: unknown[]) => mockSubmitProposal(...args),
  };
});

jest.mock("../../../../lib/soroban/pipeline", () => ({
  executeContractCall: (...args: unknown[]) => mockExecuteContractCall(...args),
  newTxId: () => "tx-test-1",
}));

import { ProposalWizard } from "../_components/ProposalWizard";
import { ProposalSignerProvider } from "../_components/wallet";
import type { ContractCallResult, WalletSigner } from "../../../../lib/soroban/types";
import type { ThresholdState } from "../../../../lib/governance/submit";
import { DRAFT_STORAGE_KEY } from "../../../../lib/governance/draft";

// Checksum-valid Stellar addresses (verified against stellar-sdk in
// lib/governance/__tests__/strkey.test.ts).
const PROPOSER = "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4";
const MARKET_CONTRACT = "CBBHHFC3EFY34FOJOBHR52V2BE6QPNCRHDK7UJS64YC2NNL4JIPNUOPR";
const VAULT_CONTRACT = "CBLY5XSJLCYNHLV7WTULBLSVX2XXAHNZACQYGGKNXAKCICWITZBKXRWY";

const signer = { publicKey: PROPOSER, sign: jest.fn(), signTypedData: jest.fn() } as unknown as WalletSigner;

const THRESHOLD_OK: ThresholdState = {
  votingPower: 5_000n,
  threshold: 1_000n,
  proposalThreshold: 0n,
};

const THRESHOLD_SHORT: ThresholdState = {
  votingPower: 10n,
  threshold: 1_000n,
  proposalThreshold: 0n,
};

const CONTRACT_IDS = {
  market: MARKET_CONTRACT,
  vault: VAULT_CONTRACT,
  deployer: VAULT_CONTRACT,
};

/** Reader that always reports the current value as "100". */
const reader = async () => "100";

function renderWizard(props: Partial<React.ComponentProps<typeof ProposalWizard>> = {}) {
  return render(
    <ProposalSignerProvider value={{ signer, address: PROPOSER }}>
      <ProposalWizard
        signer={signer}
        proposer={PROPOSER}
        contractIds={CONTRACT_IDS}
        governorContractId={CONTRACT_IDS.market}
        thresholdState={THRESHOLD_OK}
        reader={reader}
        persistDraft={false}
        {...props}
      />
    </ProposalSignerProvider>
  );
}

/** Fill in step 1 with valid metadata and move to step 2. */
function completeStepOne() {
  fireEvent.change(screen.getByLabelText("Title"), {
    target: { value: "Raise the collateral ratio to 120%" },
  });
  fireEvent.change(screen.getByLabelText("Summary"), {
    target: { value: "Tighten short-put risk" },
  });
  fireEvent.change(screen.getByLabelText("Description"), {
    target: {
      value:
        "## Rationale\n\nThe current ratio leaves the short put under-collateralised after the volatility review.\n\n- Raise to 120%\n- Add guardian review",
    },
  });
  fireEvent.click(screen.getByRole("button", { name: "Continue" }));
}

/**
 * Continue is disabled until the step's requirements are met, and the click is
 * followed by an async simulation — so wait for the button to enable, click,
 * then wait for the step to actually change.
 */
async function continueWhenEnabled() {
  const wizard = screen.getByTestId("proposal-wizard");
  const from = wizard.getAttribute("data-step");
  const button = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(button).not.toBeDisabled());
  fireEvent.click(button);
  await waitFor(() => expect(wizard.getAttribute("data-step")).not.toBe(from));
}

/** Add the default (market / set_collateral_ratio) action and advance to step 3. */
async function addDefaultAction() {
  fireEvent.click(screen.getByRole("button", { name: "+ Add action" }));
  await continueWhenEnabled();
}

/** Pick a specific catalog function, then add it as an action. */
function addAction(contractKey: string, functionName: string) {
  fireEvent.change(screen.getByLabelText("Contract"), { target: { value: contractKey } });
  fireEvent.change(screen.getByLabelText("Function"), { target: { value: functionName } });
  fireEvent.click(screen.getByRole("button", { name: "+ Add action" }));
}

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockSubmitProposal.mockResolvedValue({
    txId: "tx-1",
    hash: "abc123",
    fees: {},
    returnValue: null,
    elapsedMs: 12,
  } as unknown as ContractCallResult);
});

describe("ProposalWizard — step gating", () => {
  it("starts on the details step", () => {
    renderWizard();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeInTheDocument();
  });

  it("blocks step 1 until a title and description are present", () => {
    renderWizard();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    // Still on step 1.
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Add a title and a description to continue")).toBeInTheDocument();
  });

  it("rejects a title that is too short", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Short" } });
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "x".repeat(60) },
    });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("blocks step 2 until an action is added", () => {
    renderWizard();
    completeStepOne();
    expect(screen.getByText("Add at least one action to continue")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });

  it("walks all four steps and reaches review", async () => {
    renderWizard();
    completeStepOne();
    await addDefaultAction();
    expect(screen.getByText("Projected effect")).toBeInTheDocument();
    await continueWhenEnabled();
    expect(screen.getByTestId("proposal-wizard")).toHaveAttribute("data-step", "3");
    expect(screen.getByText("Estimated fee")).toBeInTheDocument();
    expect(screen.getByText("Proposal threshold")).toBeInTheDocument();
  });
});

describe("ProposalWizard — Markdown preview", () => {
  it("renders headings and lists from the body", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "## Rationale\n\n- One\n- Two" },
    });
    expect(screen.getByText("Rationale")).toBeInTheDocument();
    expect(screen.getByText("One")).toBeInTheDocument();
    expect(screen.getByText("Two")).toBeInTheDocument();
  });

  it("renders a safe link as an anchor", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "See [thread](https://forum.example.com/t/1) for detail." },
    });
    const link = screen.getByRole("link", { name: "thread" });
    expect(link).toHaveAttribute("href", "https://forum.example.com/t/1");
  });

  it("does not create an anchor for a javascript: link", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Description"), {
      target: { value: "[click](javascript:alert(1))" },
    });
    expect(screen.queryByRole("link", { name: "click" })).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-preview")).toHaveTextContent("javascript:alert(1)");
  });

  it("shows an empty state before anything is typed", () => {
    renderWizard();
    expect(screen.getByTestId("markdown-empty")).toBeInTheDocument();
  });

  it("flags an invalid discussion URL", () => {
    renderWizard();
    fireEvent.change(screen.getByLabelText("Discussion link"), {
      target: { value: "not-a-url" },
    });
    expect(screen.getByText("Invalid discussion link")).toBeInTheDocument();
  });
});

describe("ProposalWizard — action builder", () => {
  it("populates the contract and function dropdowns from the catalog", () => {
    renderWizard();
    completeStepOne();

    const contract = screen.getByLabelText("Contract") as HTMLSelectElement;
    expect(contract.options.length).toBeGreaterThan(1);
    expect([...contract.options].map((o) => o.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining("Market")])
    );

    const fn = screen.getByLabelText("Function") as HTMLSelectElement;
    expect(fn.options.length).toBeGreaterThan(0);
  });

  it("switches the available functions when the contract changes", () => {
    renderWizard();
    completeStepOne();

    const before = (screen.getByLabelText("Function") as HTMLSelectElement).options.length;
    fireEvent.change(screen.getByLabelText("Contract"), { target: { value: "timelock" } });
    const after = (screen.getByLabelText("Function") as HTMLSelectElement).options.length;
    expect(after).toBeGreaterThan(0);
    expect(after).not.toBe(before);
  });

  it("generates typed inputs for the selected function's params", () => {
    renderWizard();
    completeStepOne();
    fireEvent.click(screen.getByRole("button", { name: "+ Add action" }));

    // The form is generated from the catalog spec, so the param is labelled.
    const field = screen.getByLabelText("Collateral ratio") as HTMLInputElement;
    expect(field).toBeInTheDocument();
    expect(field).toHaveValue("11000");
  });

  it("shows a human-readable summary for the action", () => {
    renderWizard();
    completeStepOne();
    fireEvent.click(screen.getByRole("button", { name: "+ Add action" }));
    expect(
      screen.getByText("Put collateral ratio → Collateral ratio 110%")
    ).toBeInTheDocument();
  });

  it("removes an action when asked", () => {
    renderWizard();
    completeStepOne();
    fireEvent.click(screen.getByRole("button", { name: "+ Add action" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove action 1" }));
    expect(screen.getByText("No actions yet")).toBeInTheDocument();
  });
});

describe("ProposalWizard — simulation", () => {
  it("renders the current -> proposed diff", async () => {
    renderWizard();
    completeStepOne();
    await addDefaultAction();
    // Header row labels the current value column.
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("renders the read current value beside the proposed value", async () => {
    renderWizard();
    completeStepOne();
    await addDefaultAction();
    // The injected reader reports 100; the proposed ratio is 11000 bps = 110%.
    expect(await screen.findByText("1%")).toBeInTheDocument();
    expect(screen.getByText("110%")).toBeInTheDocument();
  });

  it("warns when the network read is unavailable", async () => {
    renderWizard({ reader: async () => null });
    completeStepOne();
    await addDefaultAction();
    expect(
      await screen.findByText(/could not be read from the network/i)
    ).toBeInTheDocument();
  });

  it("flags a dangerous action", () => {
    renderWizard();
    completeStepOne();
    addAction("timelock", "set_admin");
    expect(screen.getByText("This action is hard to reverse")).toBeInTheDocument();
  });
});

describe("ProposalWizard — review and submit", () => {
  async function reachReview(props: Partial<React.ComponentProps<typeof ProposalWizard>> = {}) {
    renderWizard(props);
    completeStepOne();
    await addDefaultAction();
    await continueWhenEnabled();
  }

  it("shows the fee estimate and threshold status", async () => {
    await reachReview();
    expect(screen.getByText("Estimated fee")).toBeInTheDocument();
    expect(screen.getByText("Meets the proposal threshold")).toBeInTheDocument();
  });

  it("disables submit when the proposer is below the threshold", async () => {
    await reachReview({ thresholdState: THRESHOLD_SHORT });
    expect(screen.getByText(/more to reach the proposal threshold/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit proposal" })).toBeDisabled();
  });

  it("submits and reports the transaction hash", async () => {
    await reachReview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
    });

    await waitFor(() => expect(mockSubmitProposal).toHaveBeenCalledTimes(1));
    const [options, onEvent] = mockSubmitProposal.mock.calls[0];
    expect(options.governorContractId).toBe(CONTRACT_IDS.market);
    expect(options.proposer).toBe(PROPOSER);
    expect(options.draft.title).toBe("Raise the collateral ratio to 120%");
    expect(typeof onEvent).toBe("function");

    await waitFor(() => expect(screen.getByTestId("submitted-hash")).toHaveTextContent("abc123"));
  });

  it("surfaces a submission failure without losing the draft", async () => {
    mockSubmitProposal.mockRejectedValueOnce(new Error("Governor contract is not configured"));
    await reachReview();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Submit proposal" }));
    });

    await waitFor(() => expect(screen.getByText("Submission failed")).toBeInTheDocument());
    expect(screen.getByText("Governor contract is not configured")).toBeInTheDocument();
  });

  it("prompts for a wallet when none is connected", async () => {
    await reachReview({ signer: null });
    expect(screen.getByText("Wallet not connected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit proposal" })).toBeDisabled();
  });
});

describe("ProposalWizard — dangerous proposals", () => {
  it("requires an explicit acknowledgement before submitting", async () => {
    renderWizard();
    completeStepOne();
    addAction("deployer", "upgrade_contract");

    // Fill the two required params, otherwise the simulation blocks the flow.
    // The picker's "Contract" is a combobox; the action's param is a textbox.
    fireEvent.change(screen.getByRole("textbox", { name: "Contract" }), {
      target: { value: CONTRACT_IDS.deployer },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "WASM hash" }), {
      target: { value: "a".repeat(64) },
    });

    // actions -> simulate -> review
    await continueWhenEnabled();
    await continueWhenEnabled();

    const submit = screen.getByRole("button", { name: "Submit high-impact proposal" });
    expect(submit).toBeDisabled();

    const checkbox = screen.getByRole("checkbox");
    fireEvent.click(checkbox);
    expect(submit).not.toBeDisabled();
  });

  it("blocks the flow while a required action field is empty", async () => {
    renderWizard();
    completeStepOne();
    addAction("deployer", "upgrade_contract");
    await continueWhenEnabled();

    // The error is visible on the simulate step…
    expect(await screen.findByText("Some actions are not valid yet", undefined, { timeout: 5000 })).toBeInTheDocument();
    // …but the user cannot reach review.
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("proposal-wizard")).toHaveAttribute("data-step", "2");
  });

  it("does not offer a plain submit button for a dangerous proposal", async () => {
    renderWizard();
    completeStepOne();
    addAction("market", "set_paused");
    await continueWhenEnabled();
    await continueWhenEnabled();

    expect(screen.queryByRole("button", { name: "Submit proposal" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit high-impact proposal" })).toBeInTheDocument();
  });
});

describe("ProposalWizard — draft persistence", () => {
  it("autosaves the draft to localStorage", async () => {
    jest.useFakeTimers();
    try {
      renderWizard({ persistDraft: true });
      fireEvent.change(screen.getByLabelText("Title"), {
        target: { value: "Raise the collateral ratio to 120%" },
      });
      act(() => {
        jest.advanceTimersByTime(500);
      });
      const raw = window.localStorage.getItem(DRAFT_STORAGE_KEY);
      expect(raw).toBeTruthy();
      expect(raw).toContain("Raise the collateral ratio");
    } finally {
      jest.useRealTimers();
    }
  });

  it("restores a saved draft on mount", () => {
    window.localStorage.setItem(
      DRAFT_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        title: "Restored proposal title",
        summary: "restored",
        body: "x".repeat(60),
        discussionUrl: "",
        actions: [],
        updatedAt: Date.now(),
      })
    );

    renderWizard({ persistDraft: true });
    expect(screen.getByLabelText("Title")).toHaveValue("Restored proposal title");
  });
});
