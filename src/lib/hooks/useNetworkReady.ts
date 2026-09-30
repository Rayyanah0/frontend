"use client";

import { useNetworkGuard } from "./useNetworkGuard";

/**
 * Returns `true` only when the wallet's active network matches the app's
 * expected network AND no account-change has been detected. Components
 * that trigger on-chain signing should gate their submit buttons and
 * handlers behind this:
 *
 *   const networkReady = useNetworkReady();
 *   <button disabled={!networkReady || submitting}>Sign</button>
 */
export function useNetworkReady(): boolean {
  const state = useNetworkGuard();
  return state.status === "ok";
}
