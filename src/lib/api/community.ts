// Community strategy gallery API — publish, discover, upvote, import.

import { apiGet, apiPost, apiDelete } from "./client";

export type StrategySortBy = "new" | "top" | "trending";

export interface StrategyLeg {
  option_type: "call" | "put";
  position_type: "long" | "short";
  strike_offset_pct: number; // e.g. +5 = 5% OTM
  expiry_days: number;
  contracts: number;
}

/** Versioned strategy definition — validated with Zod on publish and import. */
export interface StrategyDefinition {
  schema_version: 1;
  underlying: string;
  legs: StrategyLeg[];
}

export interface CommunityStrategy {
  id: string;
  author_wallet: string;
  name: string;
  description: string; // sanitized markdown
  tags: string[];
  definition: StrategyDefinition;
  upvotes: number;
  has_upvoted: boolean;
  flagged: boolean;
  created_at: string;
  updated_at: string;
}

export interface StrategyListResponse {
  strategies: CommunityStrategy[];
  total: number;
  page: number;
  per_page: number;
}

export interface PublishStrategyInput {
  name: string;
  description: string;
  tags: string[];
  definition: StrategyDefinition;
  /** Signed message proving wallet ownership. */
  ownership_proof: string;
}

export function listStrategies(
  params: { sort?: StrategySortBy; tag?: string; q?: string; page?: number },
  token?: string | null
): Promise<StrategyListResponse> {
  const sp = new URLSearchParams();
  if (params.sort) sp.set("sort", params.sort);
  if (params.tag)  sp.set("tag", params.tag);
  if (params.q)    sp.set("q", params.q);
  if (params.page) sp.set("page", String(params.page));
  return apiGet<StrategyListResponse>(`/community/strategies?${sp.toString()}`, token);
}

export function getStrategy(id: string, token?: string | null): Promise<CommunityStrategy> {
  return apiGet<CommunityStrategy>(`/community/strategies/${id}`, token);
}

export function publishStrategy(
  input: PublishStrategyInput,
  token: string
): Promise<CommunityStrategy> {
  return apiPost<CommunityStrategy>("/community/strategies", input, token);
}

export function upvoteStrategy(id: string, token: string): Promise<{ upvotes: number }> {
  return apiPost<{ upvotes: number }>(`/community/strategies/${id}/upvote`, undefined, token);
}

export function flagStrategy(
  id: string,
  reason: string,
  token: string
): Promise<{ flagged: boolean }> {
  return apiPost<{ flagged: boolean }>(
    `/community/strategies/${id}/flag`,
    { reason },
    token
  );
}

export function deleteStrategy(id: string, token: string): Promise<void> {
  return apiDelete<void>(`/community/strategies/${id}`, token);
}
