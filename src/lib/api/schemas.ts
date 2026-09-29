// Zod schemas for every backend response. Types in ./types.ts are derived
// from these via z.infer, so the runtime check and the static type can't
// drift apart. Field names stay snake_case to match the Rust serde output.
//
// Policy: unknown extra fields are STRIPPED (z.object default) so a backend
// that adds fields never breaks the UI; missing/wrong-typed fields fail
// loudly with a ContractError. Numeric fields sent as strings are coerced
// (`num`); timestamps may be null where the backend uses Option<...>.
import { z } from "zod";

const num = z.preprocess(v => (typeof v === "string" && v.trim() !== "" ? Number(v) : v), z.number().finite());
const nullableNum = z.preprocess(
  v => (typeof v === "string" && v.trim() !== "" ? Number(v) : v),
  z.number().finite().nullable()
);

export const BSResultSchema = z.object({
  premium: num, delta: num, gamma: num, theta: num, vega: num, rho: num,
  d1: num, d2: num, intrinsic: num, time_value: num, iv: num,
});

export const SpotResponseSchema = z.object({
  prices: z.record(num),
  vols: z.record(num),
});

export const OptionChainEntrySchema = z.object({
  strike: num,
  expiry_days: num,
  call: BSResultSchema,
  put: BSResultSchema,
  is_itm_call: z.boolean(),
  is_itm_put: z.boolean(),
});
export const OptionChainSchema = z.array(OptionChainEntrySchema);

export const ExpiryInfoSchema = z.object({ days_to_expiry: num, label: z.string(), timestamp: num });
export const ExpiryCalendarSchema = z.object({
  underlying: z.string(), spot: num, vol: num, expiries: z.array(ExpiryInfoSchema),
});

export const IvResultSchema = z.object({ implied_vol: num });

export const OptionTypeSchema = z.enum(["call", "put"]);
export const PositionTypeSchema = z.enum(["long", "short"]);
export const PositionStatusSchema = z.enum(["open", "closed", "rolled"]);

export const AccountSchema = z.object({
  wallet_address: z.string(), balance: num, collateral_locked: num, created_at: z.string(),
});

export const PositionSchema = z.object({
  id: z.string(),
  wallet_address: z.string(),
  underlying: z.string(),
  strike: num,
  expiry_days: num,
  option_type: OptionTypeSchema,
  position_type: PositionTypeSchema,
  contracts: num,
  entry_premium: num,
  entry_spot: num,
  collateral: num,
  status: PositionStatusSchema,
  close_premium: nullableNum,
  close_spot: nullableNum,
  realized_pnl: nullableNum,
  opened_at: z.string(),
  closed_at: z.string().nullable(),
  strategy_id: z.string().nullable(),
});
export const PositionListSchema = z.array(PositionSchema);

export const HistoryStatsSchema = z.object({
  trade_count: num, win_count: num, loss_count: num, total_realized_pnl: num,
});
export const HistoryResponseSchema = z.object({ trades: z.array(PositionSchema), stats: HistoryStatsSchema });

export const AggregateGreeksSchema = z.object({ delta: num, gamma: num, theta: num, vega: num });

export const WatchlistItemSchema = z.object({
  wallet_address: z.string(), underlying: z.string(), added_at: z.string(),
});
export const WatchlistSchema = z.array(WatchlistItemSchema);

export const AlertConditionSchema = z.enum(["above", "below"]);
export const AlertSchema = z.object({
  id: z.string(),
  wallet_address: z.string(),
  underlying: z.string(),
  condition: AlertConditionSchema,
  target_price: num,
  triggered: z.boolean(),
  created_at: z.string(),
  triggered_at: z.string().nullable(),
});
export const AlertListSchema = z.array(AlertSchema);

export const RollResultSchema = z.object({ closed: PositionSchema, opened: PositionSchema });

export const PayoffResponseSchema = z.object({
  points: z.array(z.object({ spot: num, pnl: num })),
  net_premium: num,
});

export const NonceResponseSchema = z.object({ nonce: z.string(), message: z.string() });
export const VerifyResponseSchema = z.object({ token: z.string(), wallet_address: z.string() });
export const MeResponseSchema = z.object({ wallet_address: z.string() });
