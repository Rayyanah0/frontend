/**
 * Thin wrappers around the Stellar Horizon REST API for the on-chain
 * readiness checks.  No SDK needed — these are simple JSON fetches.
 *
 * The Horizon base URL is configurable via NEXT_PUBLIC_HORIZON_URL; it
 * defaults to the SDF testnet horizon so the dev environment is safe.
 */

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

export const COLLATERAL_ASSET_CODE =
  process.env.NEXT_PUBLIC_COLLATERAL_ASSET_CODE ?? "USDC";
export const COLLATERAL_ASSET_ISSUER =
  process.env.NEXT_PUBLIC_COLLATERAL_ASSET_ISSUER ??
  // Circle USDC on Stellar testnet
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// Stellar base reserve per entry (0.5 XLM) and base reserve (1 XLM).
// An account with 0 sub-entries needs 1 XLM + (0 * 0.5) = 1 XLM.
// Adding a trustline is 1 sub-entry = +0.5 XLM reserve requirement.
export const BASE_RESERVE_XLM = 1;
export const RESERVE_PER_ENTRY_XLM = 0.5;
// Minimum XLM the account must hold above the reserve to pay tx fees
// (rough heuristic: 10 tx × 0.00001 XLM each = 0.001 XLM, rounded up).
export const FEE_BUFFER_XLM = 0.01;

export interface HorizonAccountBalance {
  asset_type: string; // "native" | "credit_alphanum4" | "credit_alphanum12"
  asset_code?: string;
  asset_issuer?: string;
  balance: string;
  limit?: string;
  is_authorized?: boolean;
}

export interface HorizonAccount {
  id: string;
  subentry_count: number;
  balances: HorizonAccountBalance[];
}

/** Returns null when the account doesn't exist on-chain (404). */
export async function fetchHorizonAccount(
  address: string
): Promise<HorizonAccount | null> {
  const res = await fetch(`${HORIZON_URL}/accounts/${address}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Horizon error ${res.status}: ${text}`);
  }
  return res.json() as Promise<HorizonAccount>;
}

/** XLM balance in stroops-as-number.  Returns 0 when the account has no native entry. */
export function nativeBalance(account: HorizonAccount): number {
  const entry = account.balances.find((b) => b.asset_type === "native");
  return entry ? parseFloat(entry.balance) : 0;
}

/** Minimum XLM balance required to cover existing sub-entries + optional extra ones. */
export function minXlmReserve(account: HorizonAccount, extraEntries = 0): number {
  return (
    BASE_RESERVE_XLM +
    (account.subentry_count + extraEntries) * RESERVE_PER_ENTRY_XLM
  );
}

export interface CollateralBalanceInfo {
  hasTrustline: boolean;
  balance: number; // 0 when no trustline
}

export function collateralBalance(account: HorizonAccount): CollateralBalanceInfo {
  const entry = account.balances.find(
    (b) =>
      b.asset_code === COLLATERAL_ASSET_CODE &&
      b.asset_issuer === COLLATERAL_ASSET_ISSUER
  );
  if (!entry) return { hasTrustline: false, balance: 0 };
  return { hasTrustline: true, balance: parseFloat(entry.balance) };
}

// ---------------------------------------------------------------------------
// Friendbot (testnet only) — a GET to fund a new account with 10 000 XLM.
// ---------------------------------------------------------------------------

export async function requestFriendbot(address: string): Promise<void> {
  const res = await fetch(
    `https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`
  );
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Friendbot error ${res.status}: ${text}`);
  }
}

// ---------------------------------------------------------------------------
// Horizon submit helper (used by the add-trustline flow).
// ---------------------------------------------------------------------------

export async function submitTransactionXdr(xdr: string): Promise<{ hash: string }> {
  const body = new URLSearchParams({ tx: xdr });
  const res = await fetch(`${HORIZON_URL}/transactions`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const json = await res.json().catch(() => null);
    const detail = json?.extras?.result_codes?.transaction ?? res.statusText;
    throw new Error(`Transaction failed: ${detail}`);
  }
  const data = await res.json();
  return { hash: data.hash as string };
}

// ---------------------------------------------------------------------------
// Explorer link helper.
// ---------------------------------------------------------------------------

const EXPLORER_BASE =
  process.env.NEXT_PUBLIC_EXPLORER_URL ?? "https://stellar.expert/explorer/testnet";

export function explorerAccountUrl(address: string): string {
  return `${EXPLORER_BASE}/account/${address}`;
}

export function explorerTxUrl(hash: string): string {
  return `${EXPLORER_BASE}/tx/${hash}`;
}
