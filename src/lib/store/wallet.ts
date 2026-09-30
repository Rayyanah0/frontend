import { create } from "zustand";
import { persist } from "zustand/middleware";
import freighterApi from "@stellar/freighter-api";
import { getMe, requestNonce, verifySignature } from "../api/auth";

export type WalletStatus = "idle" | "connecting" | "connected" | "not-installed" | "error";

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /** Bearer token from the backend's sign-in-with-wallet flow. Wallet
   *  connection and backend login are separate steps — a wallet can be
   * connected with `token: null` if the sign step failed or is still
   * pending, and every store/component that calls an auth-gated
   * endpoint needs to handle that. */
  token: string | null;
  error: string | null;
  /** "ledger" when the connected wallet is a Ledger hardware wallet, else
   * "freighter" (or null when disconnected). Used to gate Soroban tx signing
   * and to show device-specific guidance. */
  signerKind: "freighter" | "ledger" | null;
  connect: () => Promise<void>;
  connectLedger: (accountIndex?: number) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

// Signs the backend's nonce message with Freighter and exchanges it for a
// bearer token. Kept separate from connect()/checkConnection() so a
// failure here (backend down, user rejects the signature prompt) doesn't
// also tear down an otherwise-successful wallet connection — it just
// leaves `token: null`, which callers already have to handle.
async function signInWithBackendFreighter(address: string): Promise<string> {
  const { message } = await requestNonce(address);
  const signedBlob = await freighterApi.signBlob(message);
  const { token } = await verifySignature({ walletAddress: address, message, signature: signedBlob });
  return token as string;
}

// Signs the backend's nonce message with a Ledger device and exchanges it
// for a bearer token. The ledger adapter returns a base64 signature of the
// SHA-256 hash of the message, which the backend accepts in place of
// Freighter's signBlob output (both are 64-byte ed25519 signatures).
async function signInWithBackendLedger(
  address: string,
  signMessage: (message: string) => Promise<string>
): Promise<string> {
  const { message } = await requestNonce(address);
  const signature = await signMessage(message);
  const { token } = await verifySignature({ walletAddress: address, message, signature });
  return token as string;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: "idle",
      address: null,
      network: null,
      token: null,
      error: null,
      signerKind: null,

      connect: async () => {
        set({ status: "connecting", error: null });
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) {
            set({ status: "not-installed" });
            return;
          }
          const address = await freighterApi.requestAccess();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: "connected", address, network: details?.network ?? null, error: null, signerKind: "freighter" });

          try {
            const token = await signInWithBackendFreighter(address);
            set({ token });
          } catch (err) {
            // Wallet is connected either way; just no backend session yet.
            set({ token: null, error: err instanceof Error ? err.message : "Backend sign-in failed" });
          }
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect wallet" });
        }
      },

      connectLedger: async (accountIndex = 0) => {
        set({ status: "connecting", error: null });
        try {
          // Lazy-import the ledger signer adapter so bundlers don't pull ledger
          // code into the main bundle unless the user requests it.
          const mod = await import("../ledgerSigner");
          const connectLedgerAccount = (mod as any).default || (mod as any).connectLedgerAccount;
          if (typeof connectLedgerAccount !== "function") throw new Error("Ledger adapter not available");

          const ledger = await connectLedgerAccount(accountIndex);
          const address = ledger.address;
          set({ status: "connected", address, network: null, error: null, signerKind: "ledger" });

          try {
            const token = await signInWithBackendLedger(address, ledger.signMessage);
            set({ token });
          } catch (err) {
            // Connected but no backend session
            set({ token: null, error: err instanceof Error ? err.message : "Backend sign-in failed" });
          }
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect Ledger" });
        }
      },

      disconnect: () => set({ status: "idle", address: null, network: null, token: null, error: null, signerKind: null }),

      // Re-verify a persisted session on load rather than trusting stale state.
      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: "idle", address: null, network: null, token: null });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null);
          set({ status: "connected", address, network: details?.network ?? null, signerKind: "freighter" });

          // A persisted token might still be valid (sessions last 24h) —
          // check before making the user sign a fresh message on every
          // page load.
          const persistedToken = get().token;
          const stillValid = persistedToken
            ? await getMe(persistedToken)
                .then(() => true)
                .catch(() => false)
            : false;

          if (stillValid) return;

          try {
            const token = await signInWithBackendFreighter(address);
            set({ token });
          } catch {
            set({ token: null });
          }
        } catch {
          set({ status: "idle", address: null, network: null, token: null });
        }
      },
    }),
    {
      name: "zenith-wallet",
      partialize: (s) => ({ address: s.address, token: s.token }),
      skipHydration: true,
    }
  )
);
