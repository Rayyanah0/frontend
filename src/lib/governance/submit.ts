/**
 * submit.ts — Issue #89: threshold check, fee estimate and submission.
 *
 * A proposal is submitted as a single `submit_proposal` call on the governor
 * contract.  This module owns three things:
 *
 *   1. Whether the proposer clears the governor's proposal threshold.
 *   2. A pre-signature fee estimate (the real fee only exists once Soroban
 *      simulation has run, which `executeContractCall` does for us).
 *   3. Handing the call to the shared Soroban pipeline.
 *
 * The governor arguments are built here rather than in the component so the
 * encoding is unit-testable and identical to what gets submitted.
 */

import { encodeAction, type ProposalAction } from "./actions";
import { validateDraft, type ProposalDraft } from "./draft";
import { contractEnvVarName } from "../../env";
import { executeContractCall, newTxId } from "../soroban/pipeline";
import { createPipelineEventHandler, type SerializedRetryParams } from "../store/tracker";
import type {
  ContractCallParams,
  ContractCallResult,
  PipelineEvent,
  WalletSigner,
} from "../soroban/types";

/** Stroops per XLM. */
export const STROOPS_PER_XLM = 10_000_000;

/** Base inclusion fee in stroops (matches the pipeline's BASE_FEE). */
export const BASE_FEE_STROOPS = 100;

/**
 * Flat resource-fee allowance used for the pre-flight estimate, in stroops.
 * Governance writes touch a handful of ledger entries; 100,000 stroops
 * (0.01 XLM) is a safe upper bound before simulation produces a real number.
 */
export const ESTIMATED_RESOURCE_FEE_STROOPS = 100_000;

export interface ThresholdState {
  /** Proposer's voting power, in the governor's native units. */
  votingPower: bigint;
  /** Minimum power required to open a proposal. */
  threshold: bigint;
  /** Voting power needed to carry the proposal (a multiple of the threshold). */
  proposalThreshold: bigint;
}

export interface ThresholdCheck {
  /** Whether the proposer may submit at all. */
  eligible: boolean;
  /** Voting power as a share (0–1) of the proposal threshold. */
  progress: number;
  /** Short human explanation, e.g. "Needs 40.0M more GOV". */
  message: string;
}

/**
 * Compare the proposer's voting power against the governor's thresholds.
 * `depositToken` names the token so the shortfall reads sensibly.
 */
export function checkThreshold(
  state: ThresholdState,
  depositToken = "GOV"
): ThresholdCheck {
  const { votingPower, threshold, proposalThreshold } = state;
  const effective = proposalThreshold > 0n ? proposalThreshold : threshold;

  // No threshold configured (un-deployed governor / demo mode). Nothing to
  // clear, but say so rather than rendering a misleading progress bar.
  if (effective <= 0n) {
    return { eligible: true, progress: 1, message: "No proposal threshold configured" };
  }

  if (votingPower >= effective) {
    return { eligible: true, progress: 1, message: "Meets the proposal threshold" };
  }

  const short = effective - votingPower;
  return {
    eligible: false,
    progress: Number(votingPower) / Number(effective),
    message: `Needs ${formatUnits(short)} ${depositToken} more to reach the proposal threshold`,
  };
}

function formatUnits(value: bigint): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value.toString();
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return n.toFixed(0);
}

// ---------------------------------------------------------------------------
// Fee estimate
// ---------------------------------------------------------------------------

export interface FeeEstimate {
  totalStroops: number;
  totalXlm: number;
  /** null when no XLM price is available. */
  totalUsd: number | null;
  priority: "standard" | "fast";
  /** True when this is a pre-simulation estimate rather than a real fee. */
  estimated: boolean;
}

export function estimateFee(
  priority: "standard" | "fast" = "standard",
  xlmUsdPrice: number | null = null
): FeeEstimate {
  const inclusion = priority === "fast" ? BASE_FEE_STROOPS * 2 : BASE_FEE_STROOPS;
  const totalStroops = inclusion + ESTIMATED_RESOURCE_FEE_STROOPS;
  const totalXlm = totalStroops / STROOPS_PER_XLM;
  return {
    totalStroops,
    totalXlm,
    totalUsd: xlmUsdPrice !== null ? totalXlm * xlmUsdPrice : null,
    priority,
    estimated: true,
  };
}

// ---------------------------------------------------------------------------
// Proposal payload
// ---------------------------------------------------------------------------

/** Governor contract method that creates a proposal. */
export const SUBMIT_PROPOSAL_METHOD = "submit_proposal";

export interface ProposalPayloadArgs {
  title: string;
  summary: string;
  body: string;
  discussionUrl: string;
  /** One encoded sub-call per action, in order. */
  actions: { contractKey: string; contractId: string; functionName: string; args: unknown[] }[];
  /** Proposer address (G…). */
  proposer: string;
}

export interface BuildProposalError {
  ok: false;
  reason: string;
}

export interface BuiltProposal {
  ok: true;
  args: unknown[];
}

/**
 * Resolve the contract IDs a draft's actions target.  Returns an error when
 * any referenced contract is not configured — submitting an action against an
 * empty contract id would silently target the wrong contract.
 */
export function buildProposalArgs(
  draft: ProposalDraft,
  contractIds: Record<string, string | undefined>,
  proposer: string
): BuiltProposal | BuildProposalError {
  const validation = validateDraft(draft);
  if (!validation.ok) {
    const first = Object.entries(validation.errors)[0];
    return { ok: false, reason: `${first[0]}: ${first[1]}` };
  }

  if (draft.actions.length === 0) return { ok: false, reason: "Add at least one action." };

  const actions: ProposalPayloadArgs["actions"] = [];

  for (const action of draft.actions) {
    const encoded = encodeAction(action);
    if (!encoded) {
      return { ok: false, reason: `Unknown contract or function "${action.functionName}".` };
    }
    if (encoded.errors.length > 0) {
      const e = encoded.errors[0];
      return { ok: false, reason: `${e.paramName}: ${e.error.replace(/_/g, " ")}` };
    }

    const contractId = contractIds[encoded.contractKey];
    if (!contractId) {
      return {
        ok: false,
        reason: `No contract configured for "${encoded.contractName}" — set ${contractEnvVarName(encoded.contractKey)}.`,
      };
    }

    actions.push({
      contractKey: encoded.contractKey,
      contractId,
      functionName: encoded.functionName,
      args: encoded.args,
    });
  }

  return {
    ok: true,
    args: [
      draft.title.trim(),
      draft.summary.trim(),
      draft.body.trim(),
      draft.discussionUrl.trim(),
      actions.map((a) => ({ contract: a.contractId, function: a.functionName, args: a.args })),
      proposer,
    ],
  };
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

export interface SubmitOptions {
  draft: ProposalDraft;
  contractIds: Record<string, string | undefined>;
  governorContractId: string | null;
  proposer: string;
  signer: WalletSigner;
  priority?: "standard" | "fast";
  xlmUsdPrice?: number | null;
  signal?: AbortSignal;
  /** Label shown in the transaction tracker. */
  label?: string;
}

/**
 * Submit a draft through the shared Soroban pipeline.  Progress is surfaced
 * through `onEvent` exactly like every other on-chain write in the app.
 */
export async function submitProposal(
  options: SubmitOptions,
  onEvent: (event: PipelineEvent) => void
): Promise<ContractCallResult> {
  const {
    draft,
    contractIds,
    governorContractId,
    proposer,
    signer,
    priority = "standard",
    xlmUsdPrice = null,
    signal,
  } = options;

  if (!governorContractId) {
    throw new Error(
      `Governor contract is not configured — set ${contractEnvVarName("governor")} for this network.`
    );
  }

  const built = buildProposalArgs(draft, contractIds, proposer);
  // `in` narrowing rather than `!built.ok` — see the note in actions.ts.
  if ("reason" in built) throw new Error(built.reason);

  const label = options.label ?? `Propose: ${draft.title.trim() || "Untitled proposal"}`;

  const txId = newTxId();
  const retryParams: SerializedRetryParams = {
    contract: governorContractId,
    method: SUBMIT_PROPOSAL_METHOD,
    argsJson: JSON.stringify(built.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
    label,
    priority,
    meta: { label, description: draft.summary.trim() || undefined },
  };

  const handler = createPipelineEventHandler(txId, label, retryParams);

  // Forward both the tracker updates and the caller's own listener.
  const forward = (event: PipelineEvent) => {
    handler(event);
    onEvent(event);
  };

  const params: ContractCallParams = {
    contract: governorContractId,
    method: SUBMIT_PROPOSAL_METHOD,
    args: built.args,
    signer,
    priority,
    signal,
    meta: { label, description: draft.summary.trim() || undefined },
  };

  return executeContractCall(params, forward, xlmUsdPrice);
}
