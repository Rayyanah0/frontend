// Governance API — delegate directory, profiles, voting history, delegation.

import { apiGet, apiPost } from "./client";

export type DelegateSortBy = "voting_power" | "delegators" | "participation";

export interface DelegateProfile {
  wallet_address: string;
  display_name: string; // non-unique — always show wallet_address alongside it
  statement: string;    // sanitized markdown
  focus_tags: string[];
  links: DelegateLink[];
  verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface DelegateLink {
  label: string;  // e.g. "Twitter", "Forum"
  url: string;    // http/https only
}

export interface DelegateStats {
  wallet_address: string;
  voting_power: number;
  delegator_count: number;
  participation_rate: number; // 0–1
  proposals_voted: number;
  proposals_total: number;
}

export interface DelegateVote {
  proposal_id: string;
  proposal_title: string;
  vote: "for" | "against" | "abstain";
  reason: string | null;
  voted_at: string;
}

export interface DelegateSummary {
  profile: DelegateProfile;
  stats: DelegateStats;
}

export interface DelegateDetail extends DelegateSummary {
  vote_history: DelegateVote[];
  participation_by_month: { month: string; rate: number }[];
}

export interface DelegateListResponse {
  delegates: DelegateSummary[];
  total: number;
  page: number;
  per_page: number;
}

export interface UpsertProfileInput {
  display_name: string;
  statement: string;
  focus_tags: string[];
  links: DelegateLink[];
  /** Signed message proving wallet ownership. */
  ownership_proof: string;
}

export interface DelegateInput {
  /** Delegate to this wallet_address. Pass null to undelegate. */
  delegate_to: string | null;
  ownership_proof: string;
}

export function listDelegates(
  params: {
    sort?: DelegateSortBy;
    q?: string;
    page?: number;
  },
  token?: string | null
): Promise<DelegateListResponse> {
  const sp = new URLSearchParams();
  if (params.sort) sp.set("sort", params.sort);
  if (params.q)    sp.set("q", params.q);
  if (params.page) sp.set("page", String(params.page));
  return apiGet<DelegateListResponse>(`/governance/delegates?${sp.toString()}`, token);
}

export function getDelegate(
  walletAddress: string,
  token?: string | null
): Promise<DelegateDetail> {
  return apiGet<DelegateDetail>(`/governance/delegates/${walletAddress}`, token);
}

export function upsertDelegateProfile(
  input: UpsertProfileInput,
  token: string
): Promise<DelegateProfile> {
  return apiPost<DelegateProfile>("/governance/delegates/profile", input, token);
}

export function delegateTo(
  input: DelegateInput,
  token: string
): Promise<{ tx_hash: string }> {
  return apiPost<{ tx_hash: string }>("/governance/delegate", input, token);
}

export function getMyDelegation(token: string): Promise<{ delegate_to: string | null }> {
  return apiGet<{ delegate_to: string | null }>("/governance/my-delegation", token);
}
