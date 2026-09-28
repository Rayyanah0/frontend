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
   *  connected with `token: null` if the sign step failed or is still
   *  pending, and every store/component that calls an auth-gated
   *  endpoint needs to handle that. */
  token: string | null;
  error: string | null;
  connect: () => Promise<void>;
  connectLedger: (index?: number) => Promise<void>;
  disconnect: () => void;
  checkConnection: () => Promise<void>;
}

// Signs the backend's nonce message with Freighter and exchanges it for a
// bearer token. Kept separate from connect()/checkConnection() so a
// failure here (backend down, user rejects the signature prompt) doesn't
// also tear down an otherwise-successful wallet connection — it just
// leaves `token: null`, which callers already have to handle.
// Sign a backend nonce message using either the provided signer callback
// or the Freighter extension. The signer should return a base64 or hex
// encoded signature matching the backend expectation.
async function signInWithBackend(address: string, signCallback?: (message: string) => Promise<string>): Promise<string> {
  const { message } = await requestNonce(address);
  let signedBlob: string;
  if (signCallback) {
    signedBlob = await signCallback(message);
  } else {
    signedBlob = await freighterApi.signBlob(message);
  }
  const { token } = await verifySignature({ walletAddress: address, message, signature: signedBlob });
  return token;
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: "idle",
      address: null,
      network: null,
      token: null,
      error: null,

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
          set({ status: "connected", address, network: details?.network ?? null, error: null });

          try {
            const token = await signInWithBackend(address);
            set({ token });
          } catch (err) {
            // Wallet is connected either way; just no backend session yet.
            set({ token: null, error: err instanceof Error ? err.message : "Backend sign-in failed" });
          }
        } catch (err) {
          set({ status: "error", error: err instanceof Error ? err.message : "Failed to connect wallet" });
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
            set({ token });
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

      disconnect: () => set({ status: "idle", address: null, network: null, token: null, error: null }),

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
          set({ status: "connected", address, network: details?.network ?? null });

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
            const token = await signInWithBackend(address);
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
