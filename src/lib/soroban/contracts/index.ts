/**
 * contracts/index.ts — Issue #67.
 *
 * TypeScript bindings for Zenith's Soroban contracts.
 *
 * GENERATED FILE — regenerate with:
 *   npm run soroban:bindings
 *   (see scripts/regen-bindings.sh)
 *
 * These stubs represent the shape the generated bindings will have once
 * stellar contract bindings typescript is run against the deployed contracts.
 * Until real contract IDs are available, this module exports the types and
 * call-builders only — no live invocations are possible.
 *
 * Contract interfaces:
 *   - ZenithMarket: open/close/roll positions on-chain
 *   - ZenithVault:  collateral deposit/withdraw
 *   - ZenithOracle: price feed read
 */

import { Contract, xdr, nativeToScVal } from "@stellar/stellar-sdk";
import type { ZenithContracts } from "../networks";

// ── Shared types ──────────────────────────────────────────────────────────────

export type OptionSide = "call" | "put";
export type PositionDirection = "long" | "short";

/** On-chain position identifier (u64 encoded as string for JS safety) */
export type PositionId = string;

/** XDR-encoded result helpers */
export interface ScValResult<T> {
  raw: xdr.ScVal;
  decoded: T;
}

// ── Market contract bindings ───────────────────────────────────────────────────

export interface OpenPositionArgs {
  caller: string;         // Account public key (G...)
  underlying: string;     // Asset symbol, e.g. "XLM"
  strike: bigint;         // Strike price in stroops (7 decimals)
  expiryLedger: number;   // Absolute ledger number at expiry
  side: OptionSide;
  direction: PositionDirection;
  contracts: bigint;      // Number of contracts (in smallest units)
}

export interface ClosePositionArgs {
  caller: string;
  positionId: PositionId;
}

export interface RollPositionArgs {
  caller: string;
  positionId: PositionId;
  newStrike: bigint;
  newExpiryLedger: number;
}

export class ZenithMarketContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  get id(): string {
    return this.contract.contractId();
  }

  openPosition(args: OpenPositionArgs): xdr.Operation {
    return this.contract.call(
      "open_position",
      nativeToScVal(args.caller,              { type: "address" }),
      xdr.ScVal.scvSymbol(args.underlying),
      nativeToScVal(args.strike,              { type: "u128" }),
      xdr.ScVal.scvU32(args.expiryLedger),
      xdr.ScVal.scvSymbol(args.side),
      xdr.ScVal.scvSymbol(args.direction),
      nativeToScVal(args.contracts,           { type: "u128" }),
    );
  }

  closePosition(args: ClosePositionArgs): xdr.Operation {
    return this.contract.call(
      "close_position",
      nativeToScVal(args.caller,              { type: "address" }),
      nativeToScVal(BigInt(args.positionId),  { type: "u64" }),
    );
  }

  rollPosition(args: RollPositionArgs): xdr.Operation {
    return this.contract.call(
      "roll_position",
      nativeToScVal(args.caller,              { type: "address" }),
      nativeToScVal(BigInt(args.positionId),  { type: "u64" }),
      nativeToScVal(args.newStrike,           { type: "u128" }),
      xdr.ScVal.scvU32(args.newExpiryLedger),
    );
  }
}

// ── Vault contract bindings ────────────────────────────────────────────────────

export interface DepositCollateralArgs {
  caller: string;
  amount: bigint; // in stroops
}

export interface WithdrawCollateralArgs {
  caller: string;
  amount: bigint;
}

export class ZenithVaultContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  get id(): string {
    return this.contract.contractId();
  }

  deposit(args: DepositCollateralArgs): xdr.Operation {
    return this.contract.call(
      "deposit",
      nativeToScVal(args.caller,  { type: "address" }),
      nativeToScVal(args.amount,  { type: "i128" }),
    );
  }

  withdraw(args: WithdrawCollateralArgs): xdr.Operation {
    return this.contract.call(
      "withdraw",
      nativeToScVal(args.caller,  { type: "address" }),
      nativeToScVal(args.amount,  { type: "i128" }),
    );
  }
}

// ── Oracle contract bindings ──────────────────────────────────────────────────

export class ZenithOracleContract {
  private readonly contract: Contract;

  constructor(contractId: string) {
    this.contract = new Contract(contractId);
  }

  get id(): string {
    return this.contract.contractId();
  }

  getPrice(underlying: string): xdr.Operation {
    return this.contract.call(
      "get_price",
      xdr.ScVal.scvSymbol(underlying),
    );
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export interface ZenithContractClients {
  market: ZenithMarketContract;
  vault: ZenithVaultContract;
  oracle: ZenithOracleContract;
}

/**
 * Creates typed contract client instances from the network's contract IDs.
 * Returns null fields if a contract ID is not set (missing env var).
 */
export function createContractClients(contracts: ZenithContracts): ZenithContractClients | null {
  if (!contracts.market || !contracts.vault || !contracts.oracle) return null;
  return {
    market: new ZenithMarketContract(contracts.market),
    vault:  new ZenithVaultContract(contracts.vault),
    oracle: new ZenithOracleContract(contracts.oracle),
  };
}
