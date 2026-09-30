// Referral program API — generate codes, track referees, claim rewards.

import { apiGet, apiPost } from "./client";

export interface ReferralCode {
  code: string;
  wallet_address: string;
  created_at: string;
  link: string;
}

export interface Referee {
  wallet_address: string;
  joined_at: string;
  volume: number;
  rewards_generated: number;
}

export interface ReferralPeriodStats {
  period: string; // e.g. "2026-09"
  referee_count: number;
  volume: number;
  rewards_earned: number;
}

export interface ReferralDashboard {
  code: ReferralCode;
  total_referees: number;
  total_volume: number;
  rewards_earned: number;
  rewards_claimable: number;
  referees: Referee[];
  period_stats: ReferralPeriodStats[];
}

export interface ClaimResult {
  tx_hash: string;
  amount: number;
  claimed_at: string;
}

/** Fetch or lazily create the referral code for the authenticated wallet. */
export function getReferralCode(token: string): Promise<ReferralCode> {
  return apiGet<ReferralCode>("/referrals/code", token);
}

/** Fetch the full referral dashboard for the authenticated wallet. */
export function getReferralDashboard(token: string): Promise<ReferralDashboard> {
  return apiGet<ReferralDashboard>("/referrals/dashboard", token);
}

/**
 * Register a first-touch referral attribution. Called once after the user
 * connects their wallet when a `?ref=` param was captured on landing.
 * The backend ignores the call if the wallet already has an attribution.
 */
export function registerAttribution(
  referralCode: string,
  token: string
): Promise<{ registered: boolean }> {
  return apiPost<{ registered: boolean }>(
    "/referrals/attribution",
    { referral_code: referralCode },
    token
  );
}

/** Claim accrued rewards. Returns the on-chain tx hash. */
export function claimRewards(token: string): Promise<ClaimResult> {
  return apiPost<ClaimResult>("/referrals/claim", undefined, token);
}
