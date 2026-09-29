import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import freighterApi from '@stellar/freighter-api';
import { toast } from '../toast';
import { setUnauthorizedHandler } from '../api/client';
import { getMe, requestNonce, verifySignature } from '../api/auth';
import { parseAndValidateChallenge, type ParsedChallenge } from '../auth/challengeValidator';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'not-installed' | 'error';

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Bearer token from the backend's sign-in-with-wallet flow. */
  token: string | null;
  error: string | null;
  /**
   * The last parsed challenge, set before the wallet signs.
   * Components can read this to show the user what they signed.
   */
  lastChallenge: ParsedChallenge | null;
  /** Epoch ms when `token` expires (JWT `exp`, else sign-in time + 24h). */
  tokenExpiresAt: number | null;
  /** True once a 401 recovery failed or the token expired — drives the banner. */
  sessionExpired: boolean;
  connect: () => Promise<void>;
  connectLedger: (index?: number) => Promise<void>;
  disconnect: () => void;
  /** Prompts one re-sign; resolves to the new token or null. */
  reauthenticate: () => Promise<string | null>;
  checkConnection: () => Promise<void>;
}

const SESSION_MS = 24 * 60 * 60 * 1000;

function tokenExpiry(token: string): number {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    if (typeof payload.exp === "number") return payload.exp * 1000;
  } catch {
    // Not a JWT — fall back to the documented 24h session length.
  }
  return Date.now() + SESSION_MS;
}

/**
 * Signs the backend's nonce message with Freighter and exchanges it for a
 * bearer token. Validates the challenge before signing to defend against
 * phishing attacks from a malicious or compromised backend. Kept separate
 * from connect()/checkConnection() so a failure here (backend down, user
 * rejects the signature prompt) doesn't also tear down an
 * otherwise-successful wallet connection — it just leaves `token: null`,
 * which callers already have to handle.
 */
async function signInWithBackend(address: string): Promise<{ token: string; challenge: ParsedChallenge }> {
  const { message } = await requestNonce(address);

  // Validate the challenge before asking the wallet to sign.
  // Throws ChallengeValidationFailure with a precise error code on any violation.
  const challenge = parseAndValidateChallenge(message, address);

  // NOTE: Freighter's signBlob returns base64-encoded bytes.
  const signedBlob = await freighterApi.signBlob(message);
  const { token } = await verifySignature({ walletAddress: address, message, signature: signedBlob });
  return { token, challenge };
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      address: null,
      network: null,
      token: null,
      error: null,
      tokenExpiresAt: null,
      sessionExpired: false,
      lastChallenge: null,

      connect: async () => {
        set({ status: 'connecting', error: null });
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) {
            set({ status: 'not-installed' });
            return;
          }
          const address = await freighterApi.requestAccess();
          const details = await freighterApi.getNetworkDetails().catch(() => null /* deliberate: network label is optional */);
          set({ status: "connected", address, network: details?.network ?? null, error: null });

          try {
            const { token, challenge } = await signInWithBackend(address);
            set({ token, lastChallenge: challenge, tokenExpiresAt: tokenExpiry(token), sessionExpired: false });
          } catch (err) {
            set({
              token: null,
              lastChallenge: null,
              error: err instanceof Error ? err.message : 'Backend sign-in failed',
            });
          }
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to connect wallet' });
        }
      },

      connectLedger: async (index = 0) => {
        set({ status: "connecting", error: null });
        try {
          // Lazy-import the ledger signer adapter so bundlers don't pull ledger
          // code into the main bundle unless the user requests it.
          const mod = await import("../ledgerSigner");
          const connectLedgerAccount = mod.default || mod.connectLedgerAccount || mod.connectLedger;
          if (typeof connectLedgerAccount !== "function") throw new Error("Ledger adapter not available");

          const ledger = await connectLedgerAccount(index).catch((e: any) => { throw e; });
          const address = ledger.address;
          const details = null;
          set({ status: "connected", address, network: details?.network ?? null, error: null });

          try {
            const token = await signInWithBackend(address, ledger.signMessage);
            set({ token, tokenExpiresAt: tokenExpiry(token), sessionExpired: false });
          } catch (err) {
            // Connected but no backend session
            set({ token: null, error: err instanceof Error ? err.message : "Backend sign-in failed" });
          }

          // Note: keep the transport open until the user disconnects; ledger
          // adapter exposes a `close()` method the store could call on
          // disconnect if desired. For simplicity we don't persist the
          // transport reference here.
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect Ledger" });
        }
      },

      disconnect: () =>
        set({ status: "idle", address: null, network: null, token: null, error: null, tokenExpiresAt: null, sessionExpired: false }),

      reauthenticate: async () => {
        const address = get().address;
        if (!address) return null;
        try {
          const before = address;
          const token = await signInWithBackend(address);
          // Wallet may have switched accounts during the prompt.
          if (get().address !== before) return null;
          set({ token, tokenExpiresAt: tokenExpiry(token), sessionExpired: false });
          return token;
        } catch (err) {
          // Rejected or failed: clear the token and show the persistent banner. No retry loop.
          set({ token: null, tokenExpiresAt: null, sessionExpired: true });
          toast.fromError(err, { context: "Re-sign" });
          return null;
        }
      },

      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: 'idle', address: null, network: null, token: null, lastChallenge: null });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null /* deliberate: network label is optional */);
          set({ status: "connected", address, network: details?.network ?? null });

          const persistedToken = get().token;
          const stillValid = persistedToken
            ? await getMe(persistedToken)
                .then(() => true)
                .catch(() => false /* deliberate: any failure means the token is unusable; re-sign below */)
            : false;

          if (stillValid) return;

          try {
            const { token, challenge } = await signInWithBackend(address);
            set({ token, lastChallenge: challenge, tokenExpiresAt: tokenExpiry(token), sessionExpired: false });
          } catch (err) {
            set({ token: null, lastChallenge: null });
            toast.fromError(err, { context: "Sign-in" });
          }
        } catch {
          set({ status: 'idle', address: null, network: null, token: null, lastChallenge: null });
        }
      },
    }),
    {
      name: "zenith-wallet",
      partialize: (s) => ({ address: s.address, token: s.token, tokenExpiresAt: s.tokenExpiresAt }),
      skipHydration: true,
    }
  )
);

setUnauthorizedHandler(() => useWalletStore.getState().reauthenticate());
