"use client";

/**
 * Step 4 — review and submit.
 *
 * Shows the fully rendered proposal, confirms the proposer meets the proposal
 * threshold, shows the fee estimate, and requires an explicit acknowledgement
 * when the simulation flagged a dangerous action before the Soroban call is
 * sent through the shared pipeline.
 */

import { useState } from "react";
import type { ContractCallResult, PipelineEvent, WalletSigner } from "../../../../lib/soroban/types";
import { describeAction } from "../../../../lib/governance/actions";
import type { ProposalDraft } from "../../../../lib/governance/draft";
import type { SimulationResult } from "../../../../lib/governance/simulation";
import {
  BASE_FEE_STROOPS,
  checkThreshold,
  estimateFee,
  submitProposal,
  type ThresholdState,
} from "../../../../lib/governance/submit";
import { MarkdownPreview } from "./MarkdownPreview";
import { Banner, DangerButton, EYEBROW, Panel, PrimaryButton, SecondaryButton, SectionLabel } from "./ui";

function xlm(stroops: number): string {
  return `${(stroops / 10_000_000).toFixed(5)} XLM`;
}

export function StepReview({
  draft,
  simulation,
  signer,
  proposer,
  contractIds,
  governorContractId,
  thresholdState,
  onBack,
  onSubmitted,
  onDraftCleared,
}: {
  draft: ProposalDraft;
  simulation: SimulationResult | null;
  signer: WalletSigner | null;
  proposer: string;
  contractIds: Record<string, string | undefined>;
  governorContractId: string | undefined;
  thresholdState: ThresholdState;
  onBack: () => void;
  onSubmitted: (outcome: ContractCallResult) => void;
  onDraftCleared: () => void;
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const threshold = checkThreshold(thresholdState);
  const fee = estimateFee("standard");
  const needsAck = simulation?.hasDangerous ?? false;
  const hasContracts = Boolean(governorContractId);

  const blocked = !threshold.eligible || (needsAck && !acknowledged) || !hasContracts;

  const handleSubmit = async () => {
    if (!signer) return;
    setError(null);
    setSubmitting(true);
    setStage("Preparing");
    try {
      const outcome = await submitProposal(
        {
          draft,
          contractIds,
          governorContractId: governorContractId ?? null,
          proposer,
          signer,
        },
        (event: PipelineEvent) => setStage(event.stage)
      );
      onDraftCleared();
      onSubmitted(outcome);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed.");
      setStage(null);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 340px)", gap: 24 }}>
      <div>
        <Panel style={{ marginBottom: 16 }}>
          <SectionLabel>Proposal</SectionLabel>
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: 19,
              fontWeight: 600,
              color: "var(--text-hi)",
              marginBottom: 4,
            }}
          >
            {draft.title}
          </div>
          {draft.summary && (
            <div style={{ ...EYEBROW, marginBottom: 14 }}>{draft.summary}</div>
          )}
          <MarkdownPreview source={draft.body} />
          {draft.discussionUrl && (
            <div style={{ marginTop: 12, fontSize: 12 }}>
              <span style={EYEBROW}>Discussion · </span>
              <a
                href={draft.discussionUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                style={{ color: "var(--brand)" }}
              >
                {draft.discussionUrl}
              </a>
            </div>
          )}
        </Panel>

        <SectionLabel>Actions</SectionLabel>
        <Panel>
          <ol style={{ paddingLeft: 18, margin: 0 }}>
            {draft.actions.map((action, i) => (
              <li
                key={action.id}
                style={{ fontSize: 13, color: "var(--text-mid)", marginBottom: 8, lineHeight: 1.6 }}
              >
                {i + 1}. {describeAction(action)}
              </li>
            ))}
          </ol>
        </Panel>
      </div>

      <div>
        <SectionLabel>Submission</SectionLabel>
        <Panel style={{ marginBottom: 16 }}>
          <div style={EYEBROW}>Proposer</div>
          <div
            className="num"
            style={{ fontSize: 12, color: "var(--text-hi)", marginBottom: 12, wordBreak: "break-all" }}
          >
            {proposer || "Not connected"}
          </div>

          <div style={EYEBROW}>Proposal threshold</div>
          <div
            role="status"
            style={{
              fontSize: 12,
              color: threshold.eligible ? "var(--atm)" : "var(--put)",
              marginBottom: 8,
              lineHeight: 1.5,
            }}
          >
            {threshold.message}
          </div>
          <div
            style={{ height: 4, background: "var(--bg-overlay)", marginBottom: 14, overflow: "hidden" }}
          >
            <div
              style={{
                width: `${Math.max(0, Math.min(1, threshold.progress)) * 100}%`,
                height: "100%",
                background: threshold.eligible ? "var(--atm)" : "var(--atm-dim)",
              }}
            />
          </div>

          <div style={EYEBROW}>Estimated fee</div>
          <div className="num" style={{ fontSize: 13, color: "var(--text-hi)", marginBottom: 4 }}>
            {xlm(fee.totalStroops)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-lo)", lineHeight: 1.5, marginBottom: 14 }}>
            Base {xlm(BASE_FEE_STROOPS)} + resource reserve. The network charges the actual fee.
          </div>

          {needsAck && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="warn" title="High-impact proposal">
                <label
                  style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginTop: 4 }}
                >
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                    style={{ marginTop: 2 }}
                  />
                  <span>
                    I understand this changes critical protocol parameters and may be irreversible if the
                    upgrade is wrong.
                  </span>
                </label>
              </Banner>
            </div>
          )}

          {!hasContracts && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="warn" title="Contracts not configured">
                Set the governor contract ID for this network before submitting.
              </Banner>
            </div>
          )}

          {!signer && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="warn" title="Wallet not connected">
                Connect a wallet to submit. Your draft is saved locally and will be waiting.
              </Banner>
            </div>
          )}

          {error && (
            <div style={{ marginBottom: 14 }}>
              <Banner tone="danger" title="Submission failed">
                {error}
              </Banner>
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <SecondaryButton onClick={onBack} disabled={submitting}>
              Back
            </SecondaryButton>
            {needsAck ? (
              <DangerButton
                onClick={handleSubmit}
                disabled={blocked || submitting || !signer}
                style={{ flex: 1 }}
              >
                {submitting ? (stage ?? "Submitting…") : "Submit high-impact proposal"}
              </DangerButton>
            ) : (
              <PrimaryButton
                onClick={handleSubmit}
                disabled={blocked || submitting || !signer}
                style={{ flex: 1 }}
              >
                {submitting ? (stage ?? "Submitting…") : "Submit proposal"}
              </PrimaryButton>
            )}
          </div>
        </Panel>

        {threshold.eligible && hasContracts && (
          <div style={{ fontSize: 11, color: "var(--text-lo)", lineHeight: 1.6 }}>
            Submitting broadcasts <code>submit_proposal</code> to the governor. Voting opens once the
            transaction is confirmed.
          </div>
        )}
      </div>
    </div>
  );
}
