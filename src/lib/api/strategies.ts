import { apiPost } from "./client";
import type { OpenPositionParams } from "./positions";
import type { Position } from "./types";
import { PositionListSchema } from "./schemas";

export function executeStrategy(legs: OpenPositionParams[], token: string): Promise<Position[]> {
  return apiPost(
    "/api/v1/strategies/execute",
    {
      legs: legs.map((leg) => ({
        underlying: leg.underlying,
        strike: leg.strike,
        expiry_days: leg.expiryDays,
        option_type: leg.optionType,
        position_type: leg.positionType,
        contracts: leg.contracts,
      })),
    },
    token,
    PositionListSchema
  );
}
