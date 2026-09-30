"use client";

/**
 * Wallet context for the proposal wizard.
 *
 * `src/lib/store/wallet.ts` is a zero-byte file on `main`, so this feature
 * cannot import it — a static import would make the route unbuildable and a
 * dynamic one would still fail typecheck.  Instead the wizard declares the
 * dependency it needs and the app shell supplies it once the wallet store is
 * restored.  Until then the default is "not connected", which the wizard
 * renders as an explicit prompt rather than a crash.
 */

import { createContext, useContext, type ReactNode } from "react";
import type { WalletSigner } from "../../../../lib/soroban/types";

export interface ProposalSignerState {
  signer: WalletSigner | null;
  /** Proposer's public key (G…), shown on the review step. */
  address: string;
}

const ProposalSignerContext = createContext<ProposalSignerState>({
  signer: null,
  address: "",
});

export function ProposalSignerProvider({
  value,
  children,
}: {
  value: ProposalSignerState;
  children: ReactNode;
}) {
  return (
    <ProposalSignerContext.Provider value={value}>{children}</ProposalSignerContext.Provider>
  );
}

export function useProposalSigner(): ProposalSignerState {
  return useContext(ProposalSignerContext);
}
