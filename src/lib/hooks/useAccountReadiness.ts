"use client";

import { useCallback, useEffect, useState } from "react";
import {
  fetchHorizonAccount,
  nativeBalance,
  minXlmReserve,
  collateralBalance,
  FEE_BUFFER_XLM,
  RESERVE_PER_ENTRY_XLM,
  type HorizonAccount,
} from "../api/stellar";
import { useWalletStore } from "../store/wallet";

// Minimum collateral balance for on-chain trading (protocol-specific).
// Can be overridden by the env var NEXT_PUBLIC_MIN_COLLATERAL.
const MIN_COLLATERAL =
  typeof process !== "undefined" && process.env.NEXT_PUBLIC_MIN_COLLATERAL
    ? parseFloat(process.env.NEXT_PUBLIC_MIN_COLLATERAL)
    : 10; // 10 USDC minimum

export interface AccountReadiness {
  /** Account exists on Stellar ledger */
  exists: boolean;
  /** Account has enough XLM to meet the base reserve */
  meetsReserve: boolean;
  /** Collateral (USDC) trustline exists on this account */
  hasTrustline: boolean;
  /** Account holds at least MIN_COLLATERAL of the collateral asset */
  hasSufficientCollateral: boolean;
  /** True when all four checks pass */
  isReady: boolean;
  /** XLM balance (for display) */
  xlmBalance: number;
  /** Collateral balance (for display) */
  collateralBalance: number;
  /** Minimum XLM required to stay above reserve (including a trustline if not yet present) */
  minXlmRequired: number;
  /** Raw Horizon account, null when not found */
  account: HorizonAccount | null;
}

const NOT_READY: AccountReadiness = {
  exists: false,
  meetsReserve: false,
  hasTrustline: false,
  hasSufficientCollateral: false,
  isReady: false,
  xlmBalance: 0,
  collateralBalance: 0,
  minXlmRequired: 1,
  account: null,
};

/**
 * Checks on-chain account readiness for Zenith on-chain trading:
 * 1. Account exists on the Stellar ledger (funded).
 * 2. Meets the XLM reserve requirement (base + sub-entries + fee buffer).
 * 3. Has a collateral asset trustline.
 * 4. Holds at least MIN_COLLATERAL of the collateral asset.
 *
 * Refreshes whenever `address` changes and is callable manually via
 * `refresh()`. Returns `loading: true` while the Horizon fetch is in
 * flight.
 */
export function useAccountReadiness() {
  const address = useWalletStore((s) => s.address);
  const [readiness, setReadiness] = useState<AccountReadiness>(NOT_READY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!address) {
      setReadiness(NOT_READY);
      return;
    }
    setLoading(true);
    setError(null);

    fetchHorizonAccount(address)
      .then((account) => {
        if (!account) {
          setReadiness({ ...NOT_READY });
          return;
        }

        const xlm = nativeBalance(account);
        const { hasTrustline, balance: collatBal } = collateralBalance(account);

        // Reserve check: existing sub-entries; if no trustline yet, adding
        // one will cost an additional 0.5 XLM so factor that into what the
        // user currently needs.
        const extraEntries = hasTrustline ? 0 : 1;
        const minXlm = minXlmReserve(account, extraEntries) + FEE_BUFFER_XLM;
        const meetsReserve = xlm >= minXlmReserve(account, 0) + FEE_BUFFER_XLM;

        const result: AccountReadiness = {
          exists: true,
          meetsReserve,
          hasTrustline,
          hasSufficientCollateral: hasTrustline && collatBal >= MIN_COLLATERAL,
          isReady:
            meetsReserve &&
            hasTrustline &&
            collatBal >= MIN_COLLATERAL,
          xlmBalance: xlm,
          collateralBalance: collatBal,
          minXlmRequired: minXlm,
          account,
        };
        setReadiness(result);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to check account");
        setReadiness(NOT_READY);
      })
      .finally(() => setLoading(false));
  }, [address]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { readiness, loading, error, refresh };
}
