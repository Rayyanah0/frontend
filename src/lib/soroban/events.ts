// Soroban event types for Zenith contract events.
// Decodes ScVal topics and data to domain events.

export type ZenithEventType =
  | 'position_opened'
  | 'position_closed'
  | 'position_exercised'
  | 'position_settled'
  | 'deposit'
  | 'withdraw';

export interface ZenithEventBase {
  type: ZenithEventType;
  txHash: string;
  ledger: number;
  timestamp: number; // unix ms
  contractId: string;
}

export interface PositionOpenedEvent extends ZenithEventBase {
  type: 'position_opened';
  positionId: string;
  walletAddress: string;
  underlying: string;
  strike: number;
  expiryDays: number;
  optionType: 'call' | 'put';
  positionType: 'long' | 'short';
  contracts: number;
  premium: number;
}

export interface PositionClosedEvent extends ZenithEventBase {
  type: 'position_closed';
  positionId: string;
  walletAddress: string;
  closePremium: number;
  realizedPnl: number;
}

export interface PositionExercisedEvent extends ZenithEventBase {
  type: 'position_exercised';
  positionId: string;
  walletAddress: string;
  settlementPrice: number;
  payout: number;
}

export interface PositionSettledEvent extends ZenithEventBase {
  type: 'position_settled';
  positionId: string;
  walletAddress: string;
  settlementPrice: number;
  collateralReleased: number;
}

export interface DepositEvent extends ZenithEventBase {
  type: 'deposit';
  walletAddress: string;
  amount: number;
}

export interface WithdrawEvent extends ZenithEventBase {
  type: 'withdraw';
  walletAddress: string;
  amount: number;
}

export type ZenithEvent =
  | PositionOpenedEvent
  | PositionClosedEvent
  | PositionExercisedEvent
  | PositionSettledEvent
  | DepositEvent
  | WithdrawEvent;

/** Raw Soroban event as returned by the RPC getEvents endpoint */
export interface RawSorobanEvent {
  type: string;
  ledger: string;
  ledgerClosedAt: string;
  contractId: string;
  id: string;
  pagingToken: string;
  topic: ScVal[];
  value: ScVal;
  inSuccessfulContractCall: boolean;
  txHash: string;
}

/** Minimal ScVal representation — only the fields we need */
export interface ScVal {
  type: string;
  sym?: string;      // type: 'symbol'
  str?: string;      // type: 'string'
  i128?: { lo: string; hi: string }; // type: 'i128'
  u64?: string;      // type: 'u64'
  u32?: number;      // type: 'u32'
  b?: boolean;       // type: 'bool'
  bytes?: string;    // type: 'bytes' (hex)
  address?: string;  // type: 'address'
  _value?: unknown;  // fallback
}

function scValToNumber(v: ScVal): number {
  if (v.type === 'i128' && v.i128) {
    // Treat as a fixed-point with 7 decimal places (Stellar stroops convention)
    return Number(BigInt(v.i128.lo)) / 1e7;
  }
  if (v.type === 'u64' && v.u64) return Number(v.u64) / 1e7;
  if (v.type === 'u32') return v.u32 ?? 0;
  return 0;
}

function scValToString(v: ScVal): string {
  if (v.type === 'symbol') return v.sym ?? '';
  if (v.type === 'string') return v.str ?? '';
  if (v.type === 'address') return v.address ?? '';
  if (v.type === 'bytes') return v.bytes ?? '';
  return '';
}

/**
 * Attempt to decode a raw Soroban event from the Zenith contract.
 * Returns null if the event type is not recognized.
 *
 * Topic layout (by convention, matches contract spec):
 *   topic[0]: event name symbol (e.g. Symbol("position_opened"))
 *   topic[1]: wallet address
 *   topic[2+]: discriminant fields
 * Value: struct with the rest of the fields
 */
export function decodeZenithEvent(raw: RawSorobanEvent): ZenithEvent | null {
  const base: ZenithEventBase = {
    txHash: raw.txHash,
    ledger: parseInt(raw.ledger, 10),
    timestamp: new Date(raw.ledgerClosedAt).getTime(),
    contractId: raw.contractId,
    type: 'deposit', // placeholder, overridden below
  };

  const topic0 = raw.topic[0];
  if (!topic0) return null;
  const eventName = scValToString(topic0) as ZenithEventType;

  switch (eventName) {
    case 'position_opened': {
      const walletAddress = raw.topic[1] ? scValToString(raw.topic[1]) : '';
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'position_opened',
        positionId: v.position_id ? scValToString(v.position_id) : '',
        walletAddress,
        underlying: v.underlying ? scValToString(v.underlying) : '',
        strike: v.strike ? scValToNumber(v.strike) : 0,
        expiryDays: v.expiry_days ? scValToNumber(v.expiry_days) : 0,
        optionType: v.option_type ? (scValToString(v.option_type) as 'call' | 'put') : 'call',
        positionType: v.position_type ? (scValToString(v.position_type) as 'long' | 'short') : 'long',
        contracts: v.contracts ? scValToNumber(v.contracts) : 0,
        premium: v.premium ? scValToNumber(v.premium) : 0,
      };
    }
    case 'position_closed': {
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'position_closed',
        positionId: v.position_id ? scValToString(v.position_id) : '',
        walletAddress: raw.topic[1] ? scValToString(raw.topic[1]) : '',
        closePremium: v.close_premium ? scValToNumber(v.close_premium) : 0,
        realizedPnl: v.realized_pnl ? scValToNumber(v.realized_pnl) : 0,
      };
    }
    case 'position_exercised': {
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'position_exercised',
        positionId: v.position_id ? scValToString(v.position_id) : '',
        walletAddress: raw.topic[1] ? scValToString(raw.topic[1]) : '',
        settlementPrice: v.settlement_price ? scValToNumber(v.settlement_price) : 0,
        payout: v.payout ? scValToNumber(v.payout) : 0,
      };
    }
    case 'position_settled': {
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'position_settled',
        positionId: v.position_id ? scValToString(v.position_id) : '',
        walletAddress: raw.topic[1] ? scValToString(raw.topic[1]) : '',
        settlementPrice: v.settlement_price ? scValToNumber(v.settlement_price) : 0,
        collateralReleased: v.collateral_released ? scValToNumber(v.collateral_released) : 0,
      };
    }
    case 'deposit': {
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'deposit',
        walletAddress: raw.topic[1] ? scValToString(raw.topic[1]) : '',
        amount: v.amount ? scValToNumber(v.amount) : 0,
      };
    }
    case 'withdraw': {
      const v = raw.value as unknown as Record<string, ScVal>;
      return {
        ...base, type: 'withdraw',
        walletAddress: raw.topic[1] ? scValToString(raw.topic[1]) : '',
        amount: v.amount ? scValToNumber(v.amount) : 0,
      };
    }
    default:
      return null;
  }
}
