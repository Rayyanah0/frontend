/**
 * /governance/new — guided proposal creation (issue #89).
 *
 * A thin adapter: everything testable lives in `_components/ProposalWizard`,
 * which takes the signer, contract IDs, threshold state and value reader as
 * props.  `main` currently ships a zero-byte wallet store, so the signer is
 * resolved client-side and degrades to a clear "connect a wallet" state.
 */

import type { Metadata } from "next";
import { ProposalWizard } from "./_components/ProposalWizard";
import { useProposalSigner } from "./_components/wallet";
import { governableContractIds, governorContractId } from "../../../env";
import type { ThresholdState } from "../../../lib/governance/submit";

export const metadata: Metadata = {
  title: "New Proposal · Zenith",
  description: "Draft, simulate and submit a governance proposal.",
};

/**
 * Governor thresholds are read from chain in production.  Until the governor
 * contract IDs are configured the wizard treats thresholds as unset, which
 * `checkThreshold` reports as "no threshold configured" rather than blocking.
 */
const UNSET_THRESHOLDS: ThresholdState = {
  votingPower: 0n,
  threshold: 0n,
  proposalThreshold: 0n,
};

export default function NewProposalPage() {
  // Defaults to "not connected" until the app shell wraps this route in a
  // ProposalSignerProvider — see _components/wallet.tsx.
  const { signer, address } = useProposalSigner();

  return (
    <main style={{ maxWidth: 1280, margin: "0 auto", padding: "32px 24px 80px" }}>
      <header style={{ marginBottom: 28 }}>
        <div
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            color: "var(--text-lo)",
            marginBottom: 6,
          }}
        >
          Governance
        </div>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 30,
            fontWeight: 600,
            color: "var(--text-hi)",
            margin: 0,
          }}
        >
          New Proposal
        </h1>
        <p
          style={{
            fontSize: 13,
            color: "var(--text-mid)",
            margin: "8px 0 0",
            maxWidth: 620,
            lineHeight: 1.6,
          }}
        >
          Describe the change, pick the contract calls it needs, preview the effect on protocol state,
          then submit it to the governor for a vote.
        </p>
      </header>

      <ProposalWizard
        signer={signer}
        proposer={address}
        thresholdState={UNSET_THRESHOLDS}
        governorContractId={governorContractId}
        contractIds={{
          market: governableContractIds.market,
          vault: governableContractIds.vault,
          oracle: governableContractIds.oracle,
          timelock: governableContractIds.timelock,
          deployer: governableContractIds.deployer,
        }}
      />
    </main>
  );
}
