"use client";

/**
 * ProposalWizard — the four-step proposal creation flow for issue #89.
 *
 * Kept separate from `page.tsx` so the flow can be rendered and tested without
 * the App Router, and so every external dependency (signer, contract IDs,
 * threshold state, on-chain reader) arrives as a prop.  Nothing here imports
 * the wallet store or backend context, both of which are unusable on `main`.
 *
 * Steps: 1 Details · 2 Actions · 3 Simulate · 4 Review
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { ContractCallResult, WalletSigner } from "../../../../lib/soroban/types";
import { isDangerous } from "../../../../lib/governance/actions";
import {
  clearDraft,
  emptyDraft,
  loadDraft,
  saveDraft,
  validateDraft,
  type ProposalDraft,
} from "../../../../lib/governance/draft";
import type { SimulationResult, ValueReader } from "../../../../lib/governance/simulation";
import type { ThresholdState } from "../../../../lib/governance/submit";
import { StepActions } from "./StepActions";
import { StepMeta } from "./StepMeta";
import { StepReview } from "./StepReview";
import { StepSimulate } from "./StepSimulate";
import { Banner, EYEBROW, Panel, PrimaryButton, SecondaryButton } from "./ui";

const STEPS = [
  { key: "meta", label: "Details" },
  { key: "actions", label: "Actions" },
  { key: "simulate", label: "Simulate" },
  { key: "review", label: "Review" },
] as const;

type StepIndex = 0 | 1 | 2 | 3;

export interface ProposalWizardProps {
  signer: WalletSigner | null;
  /** Proposer's public key, shown on the review step. */
  proposer?: string;
  contractIds?: Record<string, string | undefined>;
  governorContractId?: string;
  thresholdState: ThresholdState;
  reader?: ValueReader;
  maxActions?: number;
  /** Skip the local-draft round trip — used by tests. */
  persistDraft?: boolean;
  onSubmitted?: (outcome: ContractCallResult) => void;
}

export function ProposalWizard({
  signer,
  proposer = "",
  contractIds = {},
  governorContractId,
  thresholdState,
  reader,
  maxActions,
  persistDraft = true,
  onSubmitted,
}: ProposalWizardProps) {
  const [step, setStep] = useState<StepIndex>(0);
  const [draft, setDraft] = useState<ProposalDraft>(emptyDraft);
  const [simulation, setSimulation] = useState<SimulationResult | null>(null);
  const [restored, setRestored] = useState(false);
  const [submitted, setSubmitted] = useState<ContractCallResult | null>(null);
  const [showValidation, setShowValidation] = useState(false);

  // Restore a saved draft once, on mount.
  useEffect(() => {
    if (!persistDraft) {
      setRestored(true);
      return;
    }
    const saved = loadDraft();
    if (saved) setDraft(saved);
    setRestored(true);
  }, [persistDraft]);

  // Autosave — debounced so typing does not hammer localStorage.
  useEffect(() => {
    if (!persistDraft || !restored) return;
    const id = setTimeout(() => saveDraft(draft), 300);
    return () => clearTimeout(id);
  }, [draft, persistDraft, restored]);

  const validation = useMemo(() => validateDraft(draft), [draft]);
  const errors = showValidation ? validation.errors : {};

  const update = useCallback((patch: Partial<ProposalDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  // Step 1 and 2 have hard requirements.  Step 3 only needs the simulation to
  // have *loaded* — errors are shown there, so the user must be able to reach
  // it.  Leaving step 3 is what actually requires a clean simulation.
  const metaOk =
    draft.title.trim().length >= 8 &&
    draft.body.trim().length >= 40 &&
    draft.summary.trim().length <= 280;
  const actionsOk = draft.actions.length > 0;
  const simLoaded = simulation !== null;
  const simOk = isSimulationReady(simulation, maxActions);

  const canAdvance = step === 0 ? metaOk : step === 1 ? actionsOk : step === 2 ? simLoaded : true;

  const blockedHint =
    step === 0
      ? "Add a title and a description to continue"
      : step === 1
        ? "Add at least one action to continue"
        : simLoaded
          ? "Fix the highlighted actions before continuing"
          : "Simulation is still running…";

  const advance = () => {
    // Errors are surfaced on this step; do not let the user reach review.
    if (step === 2 && !simOk) return;
    if (!canAdvance) {
      setShowValidation(true);
      return;
    }
    setShowValidation(false);
    setStep((s) => Math.min(3, s + 1) as StepIndex);
  };

  const back = () => {
    setShowValidation(false);
    setStep((s) => Math.max(0, s - 1) as StepIndex);
  };

  if (submitted) {
    return (
      <div data-testid="proposal-submitted">
        <Banner tone="info" title="Proposal submitted">
          Transaction{" "}
          <span className="num" data-testid="submitted-hash">
            {submitted.hash}
          </span>{" "}
          is in flight. Voting opens once it is confirmed on-chain.
        </Banner>
        <div style={{ marginTop: 16 }}>
          <SecondaryButton
            onClick={() => {
              setSubmitted(null);
              setDraft(emptyDraft());
              setSimulation(null);
              setStep(0);
            }}
          >
            Start another proposal
          </SecondaryButton>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="proposal-wizard" data-step={step}>
      <nav aria-label="Proposal steps" style={{ marginBottom: 24 }}>
        <ol style={{ display: "flex", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
          {STEPS.map((s, i) => {
            const state = i === step ? "current" : i < step ? "done" : "todo";
            return (
              <li key={s.key} style={{ flex: 1 }}>
                <button
                  type="button"
                  onClick={() => {
                    if (i <= step) setStep(i as StepIndex);
                  }}
                  aria-current={state === "current" ? "step" : undefined}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    background: state === "current" ? "var(--bg-raised)" : "transparent",
                    border: "none",
                    borderTop: `2px solid ${state === "todo" ? "var(--border-subtle)" : "var(--brand)"}`,
                    padding: "10px 12px",
                    cursor: i <= step ? "pointer" : "default",
                    opacity: state === "todo" ? 0.5 : 1,
                  }}
                >
                  <div style={EYEBROW}>Step {i + 1}</div>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: state === "current" ? 700 : 500,
                      color: state === "current" ? "var(--text-hi)" : "var(--text-mid)",
                    }}
                  >
                    {s.label}
                  </div>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      {showValidation && !validation.ok && step === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Banner tone="danger" title="Fix these before continuing">
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {Object.values(validation.errors).map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </Banner>
        </div>
      )}

      {step === 0 && <StepMeta draft={draft} errors={errors} onChange={update} />}
      {step === 1 && (
        <StepActions actions={draft.actions} draftErrors={errors} onChange={(actions) => update({ actions })} />
      )}
      {step === 2 && (
        <StepSimulate
          actions={draft.actions}
          contractIds={contractIds}
          reader={reader}
          maxActions={maxActions}
          result={simulation}
          onResult={setSimulation}
        />
      )}
      {step === 3 && (
        <StepReview
          draft={draft}
          simulation={simulation}
          signer={signer}
          proposer={proposer}
          contractIds={contractIds}
          governorContractId={governorContractId}
          thresholdState={thresholdState}
          onBack={back}
          onDraftCleared={() => {
            clearDraft();
            setRestored(false);
          }}
          onSubmitted={(outcome) => {
            setSubmitted(outcome);
            onSubmitted?.(outcome);
          }}
        />
      )}

      {step < 3 && (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginTop: 24,
            paddingTop: 16,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div>
            {step > 0 && (
              <SecondaryButton onClick={back}>Back</SecondaryButton>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!canAdvance && (
              <span style={{ fontSize: 11, color: "var(--text-lo)" }}>{blockedHint}</span>
            )}
            <PrimaryButton onClick={advance} disabled={!canAdvance}>
              Continue
            </PrimaryButton>
          </div>
        </div>
      )}

      {step === 1 && draft.actions.some(isDangerous) && (
        <div style={{ marginTop: 16 }}>
          <Panel>
            <Banner tone="warn" title="Some actions are high impact">
              Upgrades, admin rights, oracle feeds and collateral changes need an extra confirmation
              before submission.
            </Banner>
          </Panel>
        </div>
      )}
    </div>
  );
}

function isSimulationReady(result: SimulationResult | null, maxActions?: number): boolean {
  if (!result) return false;
  if (!result.withinActionLimit) return false;
  return !result.hasErrors;
}
