/**
 * Clear-signing gate — Issue #119.
 *
 * Glue between the pipeline, the decoder, and the comparator:
 *
 *   assembled XDR ──decode──▶ DecodedTransaction ──verifyIntent──▶ ok / mismatches
 *                                                         │
 *                                   mismatch ─▶ report to monitoring + block
 *
 * Also checks that the XDR the wallet hands back is the same transaction the
 * user reviewed (same hash), so a wallet or extension can't swap it either.
 */

import { TransactionBuilder } from "@stellar/stellar-sdk";
import { captureMessage, captureError } from "../monitoring";
import { decodeTransactionXdr, type DecodeOptions, type DecodedTransaction } from "./decode";
import { verifyIntent, type IntentVerification, type Mismatch, type TxIntent, type VerifyOptions } from "./intent";

export interface ReviewedTransaction {
  /** The exact XDR that was decoded — and the only XDR that may be signed. */
  xdr: string;
  networkPassphrase: string;
  decoded: DecodedTransaction;
  intent: TxIntent;
  verification: IntentVerification;
}

export type ClearSignOptions = DecodeOptions & VerifyOptions;

export class IntentMismatchError extends Error {
  readonly mismatches: Mismatch[];
  readonly txHash: string | null;
  constructor(mismatches: Mismatch[], txHash: string | null, message?: string) {
    super(message ?? `Transaction does not match your order (${mismatches.map((m) => m.field).join(", ")}). Signing was blocked.`);
    this.name = "IntentMismatchError";
    this.mismatches = mismatches;
    this.txHash = txHash;
  }
}

/** Monitoring report — field names and codes only; values are public on-chain data anyway. */
export function reportIntentMismatch(review: Pick<ReviewedTransaction, "decoded" | "intent" | "verification">): void {
  const { decoded, intent, verification } = review;
  void captureError(new IntentMismatchError(verification.mismatches, decoded.hash), {
    context: "clear-signing",
    fingerprint: ["clear-signing", "intent-mismatch", intent.kind],
    extra: {
      intentKind: intent.kind,
      txHash: decoded.hash,
      mismatches: verification.mismatches,
      warnings: decoded.warnings.map((w) => w.code),
    },
  });
}

/**
 * Decodes and verifies an assembled transaction. Never throws for a
 * mismatch — callers render the review; use `assertVerified` to block.
 * An undecodable XDR is itself reported and treated as a mismatch.
 */
export function reviewTransaction(
  xdr: string,
  networkPassphrase: string,
  intent: TxIntent,
  opts: ClearSignOptions
): ReviewedTransaction {
  let decoded: DecodedTransaction;
  try {
    decoded = decodeTransactionXdr(xdr, networkPassphrase, opts);
  } catch (err) {
    void captureError(err, { context: "clear-signing", extra: { stage: "decode", intentKind: intent.kind } });
    throw new IntentMismatchError(
      [{ code: "operation_type", field: "xdr", expected: "decodable transaction", actual: (err as Error).message }],
      null,
      "The transaction could not be decoded for review. Signing was blocked."
    );
  }

  const verification = verifyIntent(decoded, intent, opts);
  const review = { xdr, networkPassphrase, decoded, intent, verification };
  if (!verification.ok) reportIntentMismatch(review);
  else if (decoded.warnings.length > 0) {
    void captureMessage(`clear-signing: verified with warnings (${decoded.warnings.map((w) => w.code).join(",")})`, "warning");
  }
  return review;
}

export function assertVerified(review: ReviewedTransaction): void {
  if (!review.verification.ok) {
    throw new IntentMismatchError(review.verification.mismatches, review.decoded.hash);
  }
}

/**
 * Throws if the wallet returned a different transaction than the one that
 * was reviewed. Signatures don't change the hash, so any difference means
 * the body was modified.
 */
export function assertSignedMatchesReviewed(review: ReviewedTransaction, signedXdr: string): void {
  const signedHash = TransactionBuilder.fromXDR(signedXdr, review.networkPassphrase).hash().toString("hex");
  if (signedHash !== review.decoded.hash) {
    const mismatch: Mismatch = { code: "operation_type", field: "signed.hash", expected: review.decoded.hash, actual: signedHash };
    void captureError(new IntentMismatchError([mismatch], signedHash), {
      context: "clear-signing",
      fingerprint: ["clear-signing", "signed-tx-swapped"],
      extra: { reviewedHash: review.decoded.hash, signedHash },
    });
    throw new IntentMismatchError([mismatch], signedHash, "The wallet returned a different transaction than the one you reviewed.");
  }
}
