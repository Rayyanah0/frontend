"use client";

import { useEffect, useRef, useState } from "react";
import freighterApi from "@stellar/freighter-api";
import { useWalletStore } from "../store/wallet";

// The expected network passphrase is baked into the environment at build
// time. Defaults to the Stellar testnet passphrase so the dev environment
// is safe out of the box; CI/prod builds set this to the mainnet value.
const EXPECTED_PASSPHRASE =
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015"; // Stellar testnet

// Friendly name used in user-facing messages.
const EXPECTED_NETWORK_LABEL =
  process.env.NEXT_PUBLIC_NETWORK_LABEL ?? "Testnet";

// Poll interval: how often we ask Freighter for the current network and
// public key while the wallet is connected. 2 s is a reasonable balance —
// fast enough to catch a manual switch within a couple of seconds, slow
// enough not to spam the extension. No WatchWalletChanges in v2 API.
const POLL_INTERVAL_MS = 2_000;

export type NetworkGuardState =
  | { status: "ok" }
  | { status: "mismatch"; walletNetwork: string; walletPassphrase: string; expectedNetwork: string }
  | { status: "account-changed"; oldAddress: string; newAddress: string }
  | { status: "error"; message: string };

/**
 * Polls Freighter every 2 s while the wallet is connected.
 *
 * – If the wallet's network passphrase no longer matches the app's
 *   NEXT_PUBLIC_NETWORK_PASSPHRASE, returns `{ status: "mismatch" }`.
 * – If the public key in Freighter differs from the one the store recorded
 *   at sign-in (i.e. the user switched accounts inside the wallet), fires
 *   `disconnect()` to clear the stale session and returns
 *   `{ status: "account-changed" }` until the user reconnects.
 * – While the wallet isn't connected (or isn't installed) the state is
 *   `{ status: "ok" }` — guarding is only meaningful when a session exists.
 */
export function useNetworkGuard(): NetworkGuardState {
  const { status: walletStatus, address, disconnect } = useWalletStore();
  const [guardState, setGuardState] = useState<NetworkGuardState>({ status: "ok" });

  // Avoid stale-closure issues by keeping a ref to the current address.
  const addressRef = useRef(address);
  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  useEffect(() => {
    // Only poll while a session exists.
    if (walletStatus !== "connected" || !address) {
      setGuardState({ status: "ok" });
      return;
    }

    let cancelled = false;

    async function poll() {
      if (cancelled) return;

      try {
        // Check both network and public key in one round-trip sequence.
        const [details, currentAddress] = await Promise.all([
          freighterApi.getNetworkDetails().catch(() => null),
          freighterApi.getPublicKey().catch(() => null),
        ]);

        if (cancelled) return;

        // Account-change check — takes priority so we don't sign on the
        // wrong account.
        const knownAddress = addressRef.current;
        if (currentAddress && knownAddress && currentAddress !== knownAddress) {
          setGuardState({
            status: "account-changed",
            oldAddress: knownAddress,
            newAddress: currentAddress,
          });
          // Clear the stale session; the user needs to reconnect.
          disconnect();
          return;
        }

        // Network-mismatch check.
        if (details && details.networkPassphrase !== EXPECTED_PASSPHRASE) {
          setGuardState({
            status: "mismatch",
            walletNetwork: details.network ?? details.networkPassphrase,
            walletPassphrase: details.networkPassphrase,
            expectedNetwork: EXPECTED_NETWORK_LABEL,
          });
          return;
        }

        // All clear.
        setGuardState({ status: "ok" });
      } catch (err) {
        if (cancelled) return;
        setGuardState({
          status: "error",
          message: err instanceof Error ? err.message : "Could not reach Freighter",
        });
      }
    }

    // Run immediately, then on the interval.
    void poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [walletStatus, address, disconnect]);

  return guardState;
}
