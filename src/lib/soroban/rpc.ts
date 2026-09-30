/**
 * rpc.ts — Issue #67.
 *
 * Typed Soroban RPC client built on @stellar/stellar-sdk's SorobanRpc.Server.
 * Exposes typed wrappers for the operations Zenith needs:
 *   health, latestLedger, getAccount, simulateTransaction,
 *   sendTransaction, getTransaction.
 *
 * All methods throw SorobanRpcError on failure so callers can handle cleanly.
 */

import { SorobanRpc, Account, Transaction, FeeBumpTransaction } from "@stellar/stellar-sdk";
import type { NetworkConfig } from "./networks";

// Re-export so callers only need one import from this module.
export type {
  SorobanRpc,
};

export class SorobanRpcError extends Error {
  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "SorobanRpcError";
  }
}

// ── Health / ledger types ────────────────────────────────────────────────────

export interface SorobanHealth {
  status: "healthy" | "degraded" | "unreachable";
  latestLedger: number;
  latestLedgerCloseTime: number;
  /** Milliseconds since the latest ledger was closed — used by the health indicator. */
  ledgerAgeMs: number;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class ZenithSorobanClient {
  private readonly server: SorobanRpc.Server;
  readonly config: NetworkConfig;

  constructor(config: NetworkConfig) {
    this.config = config;
    this.server = new SorobanRpc.Server(config.rpcUrl, {
      allowHttp: config.name === "local",
    });
  }

  // ── Health ──────────────────────────────────────────────────────────────────

  /**
   * Returns health status: reachability + latest ledger age.
   * Never throws — returns `unreachable` on any network error.
   *
   * Note: GetLatestLedgerResponse only has { id, sequence, protocolVersion }.
   * We use Date.now() as a proxy for ledger close time since the RPC endpoint
   * doesn't expose it directly. A real implementation would poll getEvents or
   * getTransaction for actual ledger timing.
   */
  async health(): Promise<SorobanHealth> {
    try {
      const ledger = await this.server.getLatestLedger();
      // The SDK doesn't expose ledger close time — use now() as a proxy.
      // A degraded status would need to be derived from sequence staleness
      // against a known ledger rate (~5s), not an actual timestamp.
      const latestLedgerCloseTime = Date.now();
      const ledgerAgeMs = 0; // Would need block time tracking for real staleness
      return { status: "healthy", latestLedger: ledger.sequence, latestLedgerCloseTime, ledgerAgeMs };
    } catch {
      return { status: "unreachable", latestLedger: 0, latestLedgerCloseTime: 0, ledgerAgeMs: Infinity };
    }
  }

  // ── Latest ledger ───────────────────────────────────────────────────────────

  async latestLedger(): Promise<{ id: string; sequence: number; protocolVersion: string }> {
    try {
      return await this.server.getLatestLedger();
    } catch (err) {
      throw new SorobanRpcError("Failed to fetch latest ledger", err);
    }
  }

  // ── Account ─────────────────────────────────────────────────────────────────

  /**
   * Loads an Account object from the RPC server (sequence number, balances).
   * Wraps the SDK's `loadAccount` so callers don't have to think about the
   * Server instance.
   */
  async getAccount(publicKey: string): Promise<Account> {
    try {
      return await this.server.getAccount(publicKey);
    } catch (err) {
      throw new SorobanRpcError(`Failed to load account ${publicKey}`, err);
    }
  }

  // ── Simulate ─────────────────────────────────────────────────────────────────

  /**
   * Simulates a transaction to get resource/fee estimates. Returns the raw
   * SorobanRpc simulation result, which includes the authorizations needed
   * and the restored footprint if any ledger entries need restoring.
   */
  async simulateTransaction(
    tx: Transaction | FeeBumpTransaction
  ): Promise<SorobanRpc.Api.SimulateTransactionResponse> {
    try {
      return await this.server.simulateTransaction(tx);
    } catch (err) {
      throw new SorobanRpcError("Transaction simulation failed", err);
    }
  }

  // ── Send ─────────────────────────────────────────────────────────────────────

  /**
   * Submits a signed transaction to the network. Returns immediately with a
   * send result; callers should poll with `getTransaction` for the final status.
   */
  async sendTransaction(
    tx: Transaction | FeeBumpTransaction
  ): Promise<SorobanRpc.Api.SendTransactionResponse> {
    try {
      const result = await this.server.sendTransaction(tx);
      if (result.status === "ERROR") {
        throw new SorobanRpcError(`Transaction submission error: ${result.errorResult ?? "unknown"}`);
      }
      return result;
    } catch (err) {
      if (err instanceof SorobanRpcError) throw err;
      throw new SorobanRpcError("Failed to send transaction", err);
    }
  }

  // ── Poll ──────────────────────────────────────────────────────────────────────

  /**
   * Gets the status of a submitted transaction by hash. Polls until a terminal
   * state is reached or `maxAttempts` is exhausted.
   *
   * @param hash - The transaction hash from sendTransaction()
   * @param maxAttempts - Max number of polling attempts (default 20)
   * @param intervalMs - Polling interval in ms (default 1000)
   */
  async getTransaction(
    hash: string,
    maxAttempts = 20,
    intervalMs = 1000
  ): Promise<SorobanRpc.Api.GetTransactionResponse> {
    for (let i = 0; i < maxAttempts; i++) {
      try {
        const result = await this.server.getTransaction(hash);
        if (result.status !== SorobanRpc.Api.GetTransactionStatus.NOT_FOUND) {
          return result;
        }
      } catch (err) {
        // NOT_FOUND throws in some SDK versions — treat as retry
      }
      if (i < maxAttempts - 1) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }
    throw new SorobanRpcError(`Transaction ${hash} not found after ${maxAttempts} attempts`);
  }

  // ── Prepare ──────────────────────────────────────────────────────────────────

  /**
   * Convenience: simulate + assemble a transaction (adds resource fees,
   * handles restore if needed). Returns a transaction ready for signing.
   */
  async prepareTransaction(
    tx: Transaction
  ): Promise<Transaction> {
    try {
      return await this.server.prepareTransaction(tx) as Transaction;
    } catch (err) {
      throw new SorobanRpcError("Failed to prepare transaction", err);
    }
  }
}

/**
 * Creates a ZenithSorobanClient for the given network config.
 * Exported for use in useSoroban() and scripts.
 */
export function createSorobanClient(config: NetworkConfig): ZenithSorobanClient {
  return new ZenithSorobanClient(config);
}
