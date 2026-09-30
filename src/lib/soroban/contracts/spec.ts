/**
 * contracts/spec.ts — Issue #119.
 *
 * Machine-readable function spec for Zenith's Soroban contracts, mirroring
 * the call-builders in ./index.ts. The clear-signing decoder
 * (../decode.ts) uses it to label arguments by name, check their ScVal
 * types, and render amounts in asset decimals.
 *
 * Keep in sync with the generated bindings: when `npm run soroban:bindings`
 * regenerates ./index.ts, update the argument lists here as well. The
 * spec-parity test in __tests__/decode.test.ts builds every operation via
 * ./index.ts and decodes it with this spec, so drift fails CI.
 */

export type ZenithContractKind = "market" | "vault" | "oracle";

export type SpecType = "address" | "symbol" | "u32" | "u64" | "u128" | "i128" | "bool" | "string";

/** How an argument is rendered for the user. */
export type SpecUnit =
  /** Fixed-point quote-currency value (strike prices). */
  | "price"
  /** Fixed-point collateral amount. */
  | "amount"
  /** Fixed-point number of option contracts. */
  | "contracts"
  /** Absolute ledger sequence number. */
  | "ledger"
  /** Opaque identifier (position id). */
  | "id"
  /** Enum-like symbol (side, direction, underlying). */
  | "enum"
  /** Account or contract address. */
  | "account";

export interface SpecArg {
  name: string;
  /** Human label shown in the confirm dialog. */
  label: string;
  type: SpecType;
  unit: SpecUnit;
  /** Decimal places for fixed-point units. */
  decimals?: number;
  /** Suffix shown after the formatted value, e.g. "USD". */
  symbol?: string;
}

export interface SpecFunction {
  name: string;
  /** Short description of what calling this function does. */
  summary: string;
  args: SpecArg[];
}

/** Strikes, collateral amounts, and contract sizes are 7-decimal fixed point (stroop precision). */
export const ZENITH_DECIMALS = 7;

const caller: SpecArg = { name: "caller", label: "Account", type: "address", unit: "account" };

export const ZENITH_SPEC: Record<ZenithContractKind, Record<string, SpecFunction>> = {
  market: {
    open_position: {
      name: "open_position",
      summary: "Open an option position",
      args: [
        caller,
        { name: "underlying", label: "Underlying", type: "symbol", unit: "enum" },
        { name: "strike", label: "Strike", type: "u128", unit: "price", decimals: ZENITH_DECIMALS, symbol: "USD" },
        { name: "expiry_ledger", label: "Expiry ledger", type: "u32", unit: "ledger" },
        { name: "side", label: "Side", type: "symbol", unit: "enum" },
        { name: "direction", label: "Direction", type: "symbol", unit: "enum" },
        { name: "contracts", label: "Size", type: "u128", unit: "contracts", decimals: ZENITH_DECIMALS, symbol: "contracts" },
      ],
    },
    close_position: {
      name: "close_position",
      summary: "Close an option position",
      args: [caller, { name: "position_id", label: "Position", type: "u64", unit: "id" }],
    },
    roll_position: {
      name: "roll_position",
      summary: "Roll a position to a new strike / expiry",
      args: [
        caller,
        { name: "position_id", label: "Position", type: "u64", unit: "id" },
        { name: "new_strike", label: "New strike", type: "u128", unit: "price", decimals: ZENITH_DECIMALS, symbol: "USD" },
        { name: "new_expiry_ledger", label: "New expiry ledger", type: "u32", unit: "ledger" },
      ],
    },
  },
  vault: {
    deposit: {
      name: "deposit",
      summary: "Deposit collateral into the vault",
      args: [caller, { name: "amount", label: "Amount", type: "i128", unit: "amount", decimals: ZENITH_DECIMALS }],
    },
    withdraw: {
      name: "withdraw",
      summary: "Withdraw collateral from the vault",
      args: [caller, { name: "amount", label: "Amount", type: "i128", unit: "amount", decimals: ZENITH_DECIMALS }],
    },
  },
  oracle: {
    get_price: {
      name: "get_price",
      summary: "Read the oracle price",
      args: [{ name: "underlying", label: "Underlying", type: "symbol", unit: "enum" }],
    },
  },
};

export const CONTRACT_LABELS: Record<ZenithContractKind, string> = {
  market: "Zenith Market",
  vault: "Zenith Vault",
  oracle: "Zenith Oracle",
};

export function lookupFunction(kind: ZenithContractKind, fn: string): SpecFunction | null {
  return ZENITH_SPEC[kind][fn] ?? null;
}
