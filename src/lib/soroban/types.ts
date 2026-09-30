// Shared types for the Soroban on-chain pipeline, fee surface, and tracker.

// ---------------------------------------------------------------------------
// Signer abstraction — consumed by the pipeline and the backend sign-in flow.
// Wallet implementations (Freighter, xBull, Albedo, …) fulfil this interface.
// ---------------------------------------------------------------------------

export interface WalletSigner {
  /** Stellar public key (G…) */
  address: string;
  /** Network passphrase, e.g. "Test SDF Network ; September 2015" */
  networkPassphrase: string;
  /**
   * Sign a transaction XDR.  The returned XDR must include the signature(s).
   */
  signTransaction(xdr: string): Promise<string>;
  /**
   * Sign an arbitrary message blob for backend sign-in.
   * Not all wallets support this; implementations MUST throw if unsupported
   * so the caller can fall back to signing a no-op transaction.
   */
  signMessage(message: string): Promise<string>;
  /** Whether this wallet can sign raw messages (for backend sign-in). */
  canSignMessages: boolean;
}

// ---------------------------------------------------------------------------
// Fee data returned by Soroban simulation
// ---------------------------------------------------------------------------

export interface SorobanFeeBreakdown {
  /** Inclusion fee (base network fee) in stroops */
  inclusionFeeStroops: number;
  /** Resource fee charged for CPU instructions in stroops */
  cpuInstructionFeeStroops: number;
  /** Resource fee charged for read bytes in stroops */
  readBytesFeeStroops: number;
  /** Resource fee charged for write bytes in stroops */
  writeBytesFeeStroops: number;
  /** Resource fee charged for ledger entry reads in stroops */
  ledgerReadFeeStroops: number;
  /** Resource fee charged for ledger entry writes in stroops */
  ledgerWriteFeeStroops: number;
  /** Rent for newly-created storage entries in stroops */
  rentFeeStroops: number;
  /** Total resource fee (sum of the breakdown above) in stroops */
  resourceFeeStroops: number;
  /** Total fee = inclusionFee + resourceFee, in stroops */
  totalFeeStroops: number;
  /** Total fee in XLM (stroops / 10_000_000) */
  totalFeeXlm: number;
  /** Estimated total in USD (totalFeeXlm × xlmUsdPrice), null if price unknown */
  totalFeeUsd: number | null;
  /** Fee priority applied: standard or fast */
  priority: "standard" | "fast";
  /** XLM/USD price used for USD conversion, null if unknown */
  xlmUsdPrice: number | null;
  /** Number of CPU instructions consumed */
  cpuInstructions: number;
  /** Read bytes consumed */
  readBytes: number;
  /** Write bytes consumed */
  writeBytes: number;
  /** Number of ledger entries read */
  ledgerReadsCount: number;
  /** Number of ledger entries written */
  ledgerWritesCount: number;
}

// ---------------------------------------------------------------------------
// Pipeline lifecycle events (emitted as the tx progresses)
// ---------------------------------------------------------------------------

export type PipelineStage =
  | "building"
  | "simulating"
  | "awaiting_signature"
  | "submitting"
  | "pending"
  | "success"
  | "failed"
  | "cancelled";

export interface PipelineEvent {
  txId: string;
  stage: PipelineStage;
  /** Simulation fee breakdown (available from "awaiting_signature" onwards) */
  fees?: SorobanFeeBreakdown;
  /** Stellar transaction hash (available from "submitting" onwards) */
  hash?: string;
  /** Error message if stage === "failed" */
  error?: string;
  /** Human-readable error (decoded from the Soroban diagnostic) */
  humanError?: string;
  /** Raw simulation result for debugging */
  simulationResult?: unknown;
  /** XDR of the assembled transaction (useful for debugging) */
  assembledXdr?: string;
  /** Decoded contract return value (available on success) */
  returnValue?: unknown;
  /** Elapsed milliseconds since the pipeline started */
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Pipeline call params
// ---------------------------------------------------------------------------

export interface ContractCallParams {
  /** Stellar contract address (C…) */
  contract: string;
  /** Contract method name */
  method: string;
  /** Contract arguments as nativeToScVal-compatible values */
  args: unknown[];
  /** Signer to use for this call */
  signer: WalletSigner;
  /** Fee priority; defaults to "standard" */
  priority?: "standard" | "fast";
  /** AbortSignal to cancel the pipeline before signature */
  signal?: AbortSignal;
  /** Metadata passed through to tracker entries */
  meta?: ContractCallMeta;
}

export interface ContractCallMeta {
  /** Human label shown in the tracker drawer */
  label: string;
  /** Optional description */
  description?: string;
  /** Associated underlying asset, e.g. "XLM" */
  underlying?: string;
}

export interface ContractCallResult {
  txId: string;
  hash: string;
  fees: SorobanFeeBreakdown;
  returnValue: unknown;
  elapsedMs: number;
}
