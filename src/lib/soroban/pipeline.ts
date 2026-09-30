// Soroban transaction pipeline: build → simulate → assemble → sign → submit → poll.
// Every step emits a PipelineEvent so the tracker store can update the UI in real time.
// The pipeline is cancellable before the signature step.
//
// Failure modes handled:
//   - Simulation errors (including RESTORE_FOOTPRINT required)
//   - TRY_AGAIN_LATER from RPC
//   - Polling timeout
//   - User cancellation (AbortSignal)

import {
  Contract,
  Networks,
  nativeToScVal,
  SorobanRpc,
  TransactionBuilder,
  BASE_FEE,
  xdr,
} from "@stellar/stellar-sdk";
import type {
  ContractCallParams,
  ContractCallResult,
  PipelineEvent,
  SorobanFeeBreakdown,
} from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SOROBAN_RPC_URL =
  process.env.NEXT_PUBLIC_SOROBAN_RPC_URL ?? "https://soroban-testnet.stellar.org";

const NETWORK_PASSPHRASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? Networks.PUBLIC
    : Networks.TESTNET;

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL ?? "https://horizon-testnet.stellar.org";

const STELLAR_EXPLORER_BASE =
  process.env.NEXT_PUBLIC_STELLAR_NETWORK === "mainnet"
    ? "https://stellar.expert/explorer/public/tx"
    : "https://stellar.expert/explorer/testnet/tx";

/** Inclusion fee multiplier for "fast" priority (doubles the base fee) */
const FAST_FEE_MULTIPLIER = 2;

/** Max polling attempts before giving up */
const MAX_POLL_ATTEMPTS = 60;

/** Milliseconds between polling attempts */
const POLL_INTERVAL_MS = 3_000;

/** Stroops per XLM */
const STROOPS_PER_XLM = 10_000_000;

/** Max simulations retries on TRY_AGAIN_LATER */
const MAX_SIM_RETRIES = 3;

// ---------------------------------------------------------------------------
// Unique ID generation (non-crypto — just needs to be unique within a session)
// ---------------------------------------------------------------------------

let seq = 0;
export function newTxId(): string {
  return `tx-${Date.now()}-${(++seq).toString(36)}`;
}

// ---------------------------------------------------------------------------
// Explorer URL helper (network-aware)
// ---------------------------------------------------------------------------

export function explorerUrl(hash: string): string {
  return `${STELLAR_EXPLORER_BASE}/${hash}`;
}

// ---------------------------------------------------------------------------
// Fee breakdown builder from Soroban simulation result
// ---------------------------------------------------------------------------

function buildFeeBreakdown(
  sim: SorobanRpc.Api.SimulateTransactionSuccessResponse,
  priority: "standard" | "fast",
  xlmUsdPrice: number | null
): SorobanFeeBreakdown {
  // The simulation returns minResourceFee in stroops.  We use BASE_FEE (100
  // stroops) as the minimum inclusion fee; "fast" doubles it.
  const inclusionFeeStroops =
    priority === "fast"
      ? Number(BASE_FEE) * FAST_FEE_MULTIPLIER
      : Number(BASE_FEE);

  const resourceFeeStroops = Number(sim.minResourceFee ?? 0);

  // Detailed resource fee breakdown from the transaction data
  const txData = sim.transactionData;
  let cpuInstructions = 0;
  let readBytes = 0;
  let writeBytes = 0;
  let ledgerReadsCount = 0;
  let ledgerWritesCount = 0;
  let rentFeeStroops = 0;

  // Extract resource usage from SorobanTransactionData if available
  try {
    const sorobanData = txData.build();
    const resources = sorobanData.resources();
    cpuInstructions = resources.instructions();
    readBytes = resources.readBytes();
    writeBytes = resources.writeBytes();
    // ledgerFootprint read/write counts
    const footprint = resources.footprint();
    ledgerReadsCount = footprint.readOnly().length;
    ledgerWritesCount = footprint.readWrite().length;
    // Rent: only applicable when writing new entries. No SDK helper to isolate
    // this separately, so we estimate as 20% of resource fee for new entries.
    rentFeeStroops = ledgerWritesCount > 0 ? Math.round(resourceFeeStroops * 0.2) : 0;
  } catch {
    // If parsing fails, leave breakdown at zero values; totals are still accurate.
  }

  // Distribute the remaining resource fee across the sub-categories.
  // The SDK doesn't give us per-category breakdowns, so we use reasonable
  // approximations that sum correctly.
  const remaining = resourceFeeStroops - rentFeeStroops;
  const cpuShare = cpuInstructions > 0 ? 0.50 : 0;
  const rwShare = (readBytes + writeBytes) > 0 ? 0.30 : 0;
  const ledgerShare = (ledgerReadsCount + ledgerWritesCount) > 0 ? 0.20 : 0;
  const sum = cpuShare + rwShare + ledgerShare || 1;
  const cpuInstructionFeeStroops = Math.round(remaining * (cpuShare / sum));
  const readBytesFeeStroops = Math.round(remaining * (rwShare / sum) * (readBytes / Math.max(1, readBytes + writeBytes)));
  const writeBytesFeeStroops = Math.round(remaining * (rwShare / sum) * (writeBytes / Math.max(1, readBytes + writeBytes)));
  const ledgerReadFeeStroops = Math.round(remaining * (ledgerShare / sum) * (ledgerReadsCount / Math.max(1, ledgerReadsCount + ledgerWritesCount)));
  const ledgerWriteFeeStroops = remaining - cpuInstructionFeeStroops - readBytesFeeStroops - writeBytesFeeStroops - ledgerReadFeeStroops;

  const totalFeeStroops = inclusionFeeStroops + resourceFeeStroops;
  const totalFeeXlm = totalFeeStroops / STROOPS_PER_XLM;
  const totalFeeUsd = xlmUsdPrice !== null ? totalFeeXlm * xlmUsdPrice : null;

  return {
    inclusionFeeStroops,
    cpuInstructionFeeStroops: Math.max(0, cpuInstructionFeeStroops),
    readBytesFeeStroops: Math.max(0, readBytesFeeStroops),
    writeBytesFeeStroops: Math.max(0, writeBytesFeeStroops),
    ledgerReadFeeStroops: Math.max(0, ledgerReadFeeStroops),
    ledgerWriteFeeStroops: Math.max(0, ledgerWriteFeeStroops),
    rentFeeStroops,
    resourceFeeStroops,
    totalFeeStroops,
    totalFeeXlm,
    totalFeeUsd,
    priority,
    xlmUsdPrice,
    cpuInstructions,
    readBytes,
    writeBytes,
    ledgerReadsCount,
    ledgerWritesCount,
  };
}

// ---------------------------------------------------------------------------
// Decode human-readable error from a failed simulation
// ---------------------------------------------------------------------------

function decodeSimError(sim: SorobanRpc.Api.SimulateTransactionErrorResponse): string {
  const raw = sim.error ?? "Simulation failed";
  // Common Soroban error patterns
  if (raw.includes("TRY_AGAIN_LATER")) return "Network congestion — please retry in a moment.";
  if (raw.includes("RESTORE_FOOTPRINT")) return "An expired ledger entry needs restoring before this transaction can proceed.";
  if (raw.includes("InsufficientBalance")) return "Insufficient XLM balance for fees and reserves.";
  if (raw.includes("FAILED")) {
    const match = raw.match(/Error\(Contract, #(\d+)\)/);
    if (match) return `Contract error code ${match[1]}. Check contract documentation for details.`;
  }
  return raw.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Main pipeline function
// ---------------------------------------------------------------------------

export async function executeContractCall(
  params: ContractCallParams,
  onEvent: (event: PipelineEvent) => void,
  xlmUsdPrice: number | null = null
): Promise<ContractCallResult> {
  const { contract, method, args, signer, priority = "standard", signal, meta } = params;
  const txId = newTxId();
  const started = Date.now();

  const emit = (partial: Omit<PipelineEvent, "txId" | "elapsedMs">) => {
    onEvent({ txId, elapsedMs: Date.now() - started, ...partial });
  };

  // Guard: check for cancellation before each step
  const checkCancel = () => {
    if (signal?.aborted) {
      emit({ stage: "cancelled" });
      throw Object.assign(new Error("Transaction cancelled by user"), { cancelled: true });
    }
  };

  // --- STEP 1: BUILD -------------------------------------------------------

  emit({ stage: "building" });
  checkCancel();

  const server = new SorobanRpc.Server(SOROBAN_RPC_URL, { allowHttp: false });

  // Fetch account to get current sequence number
  let account;
  try {
    account = await server.getAccount(signer.address);
  } catch {
    emit({ stage: "failed", error: "Could not fetch account — is the address funded on testnet?" });
    throw new Error("Account not found on network");
  }

  checkCancel();

  const contractInstance = new Contract(contract);
  const scArgs = args.map((a) => {
    if (typeof a === "object" && a !== null && "toXDR" in a) return a as xdr.ScVal;
    return nativeToScVal(a);
  });

  const inclusionFeeStroops =
    priority === "fast" ? Number(BASE_FEE) * FAST_FEE_MULTIPLIER : Number(BASE_FEE);

  const tx = new TransactionBuilder(account, {
    fee: String(inclusionFeeStroops),
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contractInstance.call(method, ...scArgs))
    .setTimeout(30)
    .build();

  // --- STEP 2: SIMULATE ----------------------------------------------------

  emit({ stage: "simulating" });
  checkCancel();

  let sim: SorobanRpc.Api.SimulateTransactionResponse | undefined;
  let simAttempt = 0;
  while (simAttempt < MAX_SIM_RETRIES) {
    checkCancel();
    sim = await server.simulateTransaction(tx);

    if (SorobanRpc.Api.isSimulationError(sim)) {
      const errMsg = (sim as SorobanRpc.Api.SimulateTransactionErrorResponse).error ?? "";
      if (errMsg.includes("TRY_AGAIN_LATER") && simAttempt < MAX_SIM_RETRIES - 1) {
        simAttempt++;
        await new Promise<void>((r) => setTimeout(r, 2000 * simAttempt));
        continue;
      }
      const humanError = decodeSimError(sim as SorobanRpc.Api.SimulateTransactionErrorResponse);
      emit({
        stage: "failed",
        error: errMsg,
        humanError,
        simulationResult: sim,
      });
      throw Object.assign(new Error(humanError), { simulationResult: sim });
    }

    if (!SorobanRpc.Api.isSimulationSuccess(sim)) {
      emit({
        stage: "failed",
        error: "Unexpected simulation response",
        simulationResult: sim,
      });
      throw new Error("Unexpected simulation response");
    }

    break;
  }

  const successSim = sim as SorobanRpc.Api.SimulateTransactionSuccessResponse;
  const fees = buildFeeBreakdown(successSim, priority, xlmUsdPrice);

  // Assemble the transaction with resources & resource fee from simulation
  let assembled: ReturnType<typeof SorobanRpc.assembleTransaction>;
  try {
    assembled = SorobanRpc.assembleTransaction(tx, successSim);
  } catch (err) {
    emit({ stage: "failed", error: "Failed to assemble transaction", simulationResult: sim });
    throw err;
  }

  const assembledXdr = assembled.build().toXDR();

  // --- STEP 3: AWAIT SIGNATURE ---------------------------------------------

  emit({ stage: "awaiting_signature", fees, assembledXdr });
  checkCancel();

  let signedXdr: string;
  try {
    signedXdr = await signer.signTransaction(assembledXdr);
  } catch (err) {
    if (signal?.aborted) {
      emit({ stage: "cancelled" });
      throw Object.assign(new Error("Transaction cancelled by user"), { cancelled: true });
    }
    const errMsg = err instanceof Error ? err.message : "Wallet rejected the transaction";
    emit({ stage: "failed", error: errMsg, humanError: errMsg, fees, assembledXdr });
    throw new Error(errMsg);
  }

  // --- STEP 4: SUBMIT ------------------------------------------------------

  emit({ stage: "submitting", fees, assembledXdr });

  const { Transaction: SdkTransaction } = await import("@stellar/stellar-sdk");
  const signedTx = new SdkTransaction(signedXdr, NETWORK_PASSPHRASE);
  let sendResult: SorobanRpc.Api.SendTransactionResponse;
  try {
    sendResult = await server.sendTransaction(signedTx);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "Failed to submit transaction";
    emit({ stage: "failed", error: errMsg, humanError: errMsg, fees });
    throw new Error(errMsg);
  }

  if (sendResult.status === "ERROR") {
    const errMsg = `Transaction rejected: ${sendResult.errorResult?.toString() ?? "unknown error"}`;
    emit({ stage: "failed", error: errMsg, humanError: errMsg, hash: sendResult.hash, fees });
    throw new Error(errMsg);
  }

  const hash = sendResult.hash;
  emit({ stage: "pending", hash, fees });

  // --- STEP 5: POLL TO FINALITY --------------------------------------------

  let pollAttempt = 0;
  while (pollAttempt < MAX_POLL_ATTEMPTS) {
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
    checkCancel();

    let getResult: SorobanRpc.Api.GetTransactionResponse;
    try {
      getResult = await server.getTransaction(hash);
    } catch {
      pollAttempt++;
      continue;
    }

    if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      // Decode return value if present
      let returnValue: unknown = undefined;
      try {
        returnValue = getResult.returnValue ? getResult.returnValue.value() : undefined;
      } catch {
        // Non-critical — just skip
      }

      emit({ stage: "success", hash, fees, returnValue });

      return {
        txId,
        hash,
        fees,
        returnValue,
        elapsedMs: Date.now() - started,
      };
    }

    if (getResult.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const errMsg = `Transaction failed on-chain (hash: ${hash})`;
      emit({ stage: "failed", error: errMsg, humanError: errMsg, hash, fees });
      throw new Error(errMsg);
    }

    // Status is NOT_FOUND or still pending — keep polling
    pollAttempt++;
  }

  // Polling timeout
  const timeoutMsg = `Transaction not confirmed after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s — check explorer: ${explorerUrl(hash)}`;
  emit({ stage: "failed", error: timeoutMsg, humanError: timeoutMsg, hash, fees });
  throw new Error(timeoutMsg);
}
