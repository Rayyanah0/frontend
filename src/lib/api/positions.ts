import { apiGet, apiPost } from "./client";
import { AccountSchema, AggregateGreeksSchema, PositionListSchema, PositionSchema, RollResultSchema } from "./schemas";
import type { Account, AggregateGreeks, OptionType, Position, PositionStatus, PositionType } from "./types";

export function getAccount(token: string): Promise<Account> {
  return apiGet("/api/v1/account", token, AccountSchema);
}

export function listPositions(
  token: string,
  filters?: { status?: PositionStatus; strategyId?: string }
): Promise<Position[]> {
  const q = new URLSearchParams();
  if (filters?.status) q.set("status", filters.status);
  if (filters?.strategyId) q.set("strategy_id", filters.strategyId);
  const qs = q.toString();
  return apiGet(`/api/v1/positions${qs ? `?${qs}` : ""}`, token, PositionListSchema);
}

export interface OpenPositionParams {
  underlying: string;
  strike: number;
  expiryDays: number;
  optionType: OptionType;
  positionType: PositionType;
  contracts: number;
}

export function openPosition(params: OpenPositionParams, token: string): Promise<Position> {
  return apiPost(
    "/api/v1/positions/open",
    {
      underlying: params.underlying,
      strike: params.strike,
      expiry_days: params.expiryDays,
      option_type: params.optionType,
      position_type: params.positionType,
      contracts: params.contracts,
    },
    token,
    PositionSchema
  );
}

export function closePosition(id: string, token: string): Promise<Position> {
  return apiPost(`/api/v1/positions/${id}/close`, undefined, token, PositionSchema);
}

export {
  closePositionPartial,
  closeStrategy,
  detectCloseFeatures,
  isUnsupportedCloseError,
  type ClosePositionBody,
  type FeatureFlags,
} from "./close";

export interface RollResult {
  closed: Position;
  opened: Position;
}

export function rollPosition(
  id: string,
  params: { newStrike: number; newExpiryDays: number },
  token: string
): Promise<RollResult> {
  return apiPost(
    `/api/v1/positions/${id}/roll`,
    { new_strike: params.newStrike, new_expiry_days: params.newExpiryDays },
    token,
    RollResultSchema
  );
}

export function getPortfolioGreeks(token: string): Promise<AggregateGreeks> {
  return apiGet("/api/v1/portfolio/greeks", token, AggregateGreeksSchema);
}
