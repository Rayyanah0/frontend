// Settlement API — interact with expired options for claim payout and reclaim collateral
import { apiGet, apiPost } from './client';

export type SettlementStatus = 'claimable' | 'reclaimable' | 'auto_settled' | 'claimed' | 'reclaimed';

export interface SettlementEntry {
  position_id: string;
  underlying: string;
  strike: number;
  expiry_days: number;
  option_type: 'call' | 'put';
  position_type: 'long' | 'short';
  contracts: number;
  settlement_price: number;
  settlement_price_source: string;  // e.g. "Pyth oracle"
  settlement_price_timestamp: string; // ISO 8601
  settlement_price_source_url: string | null;
  settlement_status: SettlementStatus;
  payout: number;             // for long ITM: amount claimable
  collateral_released: number; // for short: collateral to reclaim
  expired_at: string;         // ISO 8601
  tx_hash: string | null;     // filled after on-chain action
}

export interface BatchClaimResult {
  claimed: string[];   // position_ids successfully claimed
  failed: string[];    // position_ids that failed
  tx_hashes: string[];
}

export function listSettlements(token: string): Promise<SettlementEntry[]> {
  return apiGet('/api/v1/settlement', token);
}

export function claimPayout(positionId: string, token: string): Promise<SettlementEntry> {
  return apiPost(`/api/v1/settlement/${positionId}/claim`, undefined, token);
}

export function reclaimCollateral(positionId: string, token: string): Promise<SettlementEntry> {
  return apiPost(`/api/v1/settlement/${positionId}/reclaim`, undefined, token);
}

export function batchClaim(positionIds: string[], token: string): Promise<BatchClaimResult> {
  return apiPost('/api/v1/settlement/batch-claim', { position_ids: positionIds }, token);
}
