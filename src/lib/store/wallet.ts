import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import freighterApi from '@stellar/freighter-api';
import { toast } from '../toast';
import { setUnauthorizedHandler } from '../api/client';
import { createSession, deleteSession, getSession, requestNonce } from '../api/auth';
import { parseAndValidateChallenge, type ParsedChallenge } from '../auth/challengeValidator';
import { BFF_SESSION_MARKER, type SessionInfo, type SessionMarker } from '../bff/constants';
import type { WalletSigner } from '../soroban/types';

export type WalletStatus = 'idle' | 'connecting' | 'connected' | 'not-installed' | 'error';

/** localStorage key used by zustand persist (unchanged, so the v2 migration can clean it up). */
export const WALLET_STORAGE_KEY = 'zenith-wallet';

interface WalletState {
  status: WalletStatus;
  address: string | null;
  network: string | null;
  /**
   * BFF session marker (#118). Set while an httpOnly session cookie exists
   * for `address`. It is NOT a credential. The backend bearer token lives
   * only in the encrypted cookie and is never exposed to JavaScript.
   */
  session: SessionMarker | null;
  error: string | null;
  /**
   * The last parsed challenge, set before the wallet signs.
   * Components can read this to show the user what they signed.
   */
  lastChallenge: ParsedChallenge | null;
  /** Epoch ms when the session expires (reported by the BFF). */
  sessionExpiresAt: number | null;
  /** True once a 401 recovery failed or the session expired — drives the banner. */
  sessionExpired: boolean;
  /** Message signer for the connected wallet (Freighter or Ledger). */
  signMessage: ((message: string) => Promise<string>) | null;
  /** "ledger" when the connected wallet is a Ledger hardware wallet, else
   * "freighter" (or null when disconnected). Used to gate Soroban tx signing
   * and to show device-specific guidance. */
  signerKind: "freighter" | "ledger" | null;
  connect: () => Promise<void>;
  connectLedger: (index?: number) => Promise<void>;
  disconnect: () => void;
  /** Prompts one re-sign; resolves to the session marker or null. */
  reauthenticate: () => Promise<string | null>;
  checkConnection: () => Promise<void>;
  /** Transaction signer for the Soroban pipeline. */
  getSigner: () => WalletSigner;
}

const freighterSignMessage = (message: string) => freighterApi.signBlob(message);

/**
 * Signs the backend's nonce message and exchanges it, via the BFF, for an
 * httpOnly session cookie. Validates the challenge before signing to defend
 * against phishing from a malicious or compromised backend. Kept separate
 * from connect()/checkConnection() so a failure here (backend down, user
 * rejects the signature prompt) doesn't also tear down an otherwise-
 * successful wallet connection. It just leaves `session: null`.
 */
async function signInWithBackend(
  address: string,
  signMessage: (message: string) => Promise<string> = freighterSignMessage
): Promise<{ info: SessionInfo; challenge: ParsedChallenge }> {
  const { message } = await requestNonce(address);

  // Throws ChallengeValidationFailure with a precise error code on any violation.
  const challenge = parseAndValidateChallenge(message, address);

  // NOTE: Freighter's signBlob returns base64-encoded bytes. The Ledger
  // adapter returns a base64 signature of the SHA-256 hash of the message,
  // which the backend accepts in place of Freighter's signBlob output (both
  // are 64-byte ed25519 signatures).
  const signature = await signMessage(message);
  const info = await createSession({ walletAddress: address, message, signature });
  if (!info.authenticated || info.wallet_address !== address) throw new Error('Backend sign-in failed');
  return { info, challenge };
}

const signedIn = (info: SessionInfo) => ({
  session: BFF_SESSION_MARKER,
  sessionExpiresAt: info.expires_at,
  sessionExpired: false,
});

const signedOut = { session: null, sessionExpiresAt: null, lastChallenge: null } as const;

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      status: 'idle',
      address: null,
      network: null,
      session: null,
      error: null,
      sessionExpiresAt: null,
      sessionExpired: false,
      lastChallenge: null,
      signMessage: null,
      signerKind: null,

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
          set({ status: 'connected', address, network: details?.network ?? null, error: null, signMessage: freighterSignMessage, signerKind: 'freighter' });

          try {
            const { info, challenge } = await signInWithBackend(address);
            set({ ...signedIn(info), lastChallenge: challenge });
          } catch (err) {
            set({ ...signedOut, error: err instanceof Error ? err.message : 'Backend sign-in failed' });
          }
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to connect wallet' });
        }
      },

      connectLedger: async (index = 0) => {
        set({ status: 'connecting', error: null });
        try {
          // Lazy-import the ledger signer adapter so bundlers don't pull ledger
          // code into the main bundle unless the user requests it.
          const { connectLedgerAccount } = await import('../ledgerSigner');
          const ledger = await connectLedgerAccount(index);
          set({ status: 'connected', address: ledger.address, network: null, error: null, signMessage: ledger.signMessage, signerKind: 'ledger' });

          try {
            const { info, challenge } = await signInWithBackend(ledger.address, ledger.signMessage);
            set({ ...signedIn(info), lastChallenge: challenge });
          } catch (err) {
            // Connected but no backend session
            set({ ...signedOut, error: err instanceof Error ? err.message : 'Backend sign-in failed' });
          }
        } catch (err) {
          set({ status: 'error', error: err instanceof Error ? err.message : 'Failed to connect Ledger' });
        }
      },

      disconnect: () => {
        set({ status: 'idle', address: null, network: null, error: null, sessionExpired: false, signMessage: null, signerKind: null, ...signedOut });
        // Clearing the cookie signs out every tab; tabs/session.ts updates their UI.
        void deleteSession().catch(() => undefined /* deliberate: local state is already cleared */);
      },

      reauthenticate: async () => {
        const address = get().address;
        if (!address) return null;
        try {
          const before = address;
          const { info, challenge } = await signInWithBackend(address, get().signMessage ?? freighterSignMessage);
          // Wallet may have switched accounts during the prompt.
          if (get().address !== before) return null;
          set({ ...signedIn(info), lastChallenge: challenge });
          return BFF_SESSION_MARKER;
        } catch (err) {
          // Rejected or failed: clear the session and show the persistent banner. No retry loop.
          set({ ...signedOut, sessionExpired: true });
          toast.fromError(err, { context: 'Re-sign' });
          return null;
        }
      },

      checkConnection: async () => {
        try {
          const installed = await freighterApi.isConnected();
          if (!installed) return;
          const allowed = await freighterApi.isAllowed();
          if (!allowed) {
            set({ status: 'idle', address: null, network: null, ...signedOut });
            return;
          }
          const address = await freighterApi.getPublicKey();
          const details = await freighterApi.getNetworkDetails().catch(() => null /* deliberate: network label is optional */);
          set({ status: 'connected', address, network: details?.network ?? null, signMessage: freighterSignMessage });

          // The cookie is the source of truth: reuse it if it belongs to this wallet.
          const current = await getSession().catch(() => null /* deliberate: treat as signed out */);
          if (current?.authenticated && current.wallet_address === address) {
            set(signedIn(current));
            return;
          }

          try {
            const { info, challenge } = await signInWithBackend(address);
            set({ ...signedIn(info), lastChallenge: challenge });
          } catch (err) {
            set(signedOut);
            toast.fromError(err, { context: 'Sign-in' });
          }
        } catch {
          set({ status: 'idle', address: null, network: null, ...signedOut });
        }
      },

      getSigner: (): WalletSigner => {
        const { address, network, signMessage } = get();
        if (!address) throw new Error('Connect a wallet first');
        const networkPassphrase =
          network === 'PUBLIC' ? 'Public Global Stellar Network ; September 2015' : 'Test SDF Network ; September 2015';
        return {
          address,
          networkPassphrase,
          canSignMessages: !!signMessage,
          signTransaction: (xdr) => freighterApi.signTransaction(xdr, { networkPassphrase, accountToSign: address }),
          signMessage: (message) => {
            if (!signMessage) throw new Error('This wallet cannot sign messages');
            return signMessage(message);
          },
        };
      },
    }),
    {
      name: WALLET_STORAGE_KEY,
      // Only the (public) address is persisted — no token, no session state.
      partialize: (s) => ({ address: s.address }),
      // v0/v1 persisted { address, token, tokenExpiresAt } — drop the token (#118).
      version: 2,
      migrate: (persisted) => {
        const old = (persisted ?? {}) as { address?: string | null };
        return { address: old.address ?? null } as unknown as WalletState;
      },
      skipHydration: true,
    }
  )
);
WALLET_STORAGE_KEY,
      // Only the (public) address is persisted — no token, no session state.
      partialize: (s) => ({ address: s.address }),
      // v0/v1 persisted { address, token, tokenExpiresAt } — drop the token (#118).
      version: 2,
      migrate: (persisted) => {
        const old = (persisted ?? {}) as { address?: string | null };
        return { address: old.address ?? null } as unknown as WalletState;
      },
      skipHydration: true,
    }
  )
);

/**
 * Removes a bearer token left in localStorage by pre-BFF builds. Runs
 * before rehydration so the token is gone even if migrate() never runs
 * (e.g. corrupted version field). Safe to call repeatedly.
 */
export function purgeLegacyWalletToken(storage: Storage | undefined = typeof window !== 'undefined' ? window.localStorage : undefined): boolean {
  if (!storage) return false;
  try {
    const raw = storage.getItem(WALLET_STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { state?: Record<string, unknown>; version?: number };
    if (!parsed.state || !('token' in parsed.state || 'tokenExpiresAt' in parsed.state)) return false;
    storage.setItem(WALLET_STORAGE_KEY, JSON.stringify({ state: { address: parsed.state.address ?? null }, version: 2 }));
    return true;
  } catch {
    storage.removeItem(WALLET_STORAGE_KEY);
    return true;
  }
}

setUnauthorizedHandler(() => useWalletStore.getState().reauthenticate());
