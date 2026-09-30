/**
 * Intent verification — Issue #119.
 *
 * Compares a decoded, assembled transaction (./decode.ts) against the
 * structured intent the UI captured from the user (strike, size, side,
 * amount…). Any difference is a mismatch, and a mismatch blocks signing.
 *
 * The intent carries *human* values (e.g. strike "0.125", amount 50) and this
 * module converts them to base units itself — deliberately independent of
 * the call-builders in ./contracts/index.ts, so a bug or tampering on the
 * build path cannot also "fix up" the comparison.
 *
 * Pure: no SDK imports, no I/O. Covered 100% by __tests__/intent.test.ts.
 */

import type { DecodedAuthNode, DecodedInvocation, DecodedTransaction } from "./decode";
import { ZENITH_DECIMALS, type ZenithContractKind } from "./contracts/spec";
import { toBaseUnits } from "./units";
import type { ZenithContracts } from "./networks";

// ── Intent shapes (what the user asked for) ───────────────────────────────────

type Decimal = string | number;

export type TxIntent =
  | {
      kind: "open_position";
      caller: string;
      underlying: string;
      strike: Decimal;
      expiryLedger: number;
      side: "call" | "put";
      direction: "long" | "short";
      /** Size in contracts (human units). */
      contracts: Decimal;
    }
  | { kind: "close_position"; caller: string; positionId: string }
  | { kind: "roll_position"; caller: string; positionId: string; newStrike: Decimal; newExpiryLedger: number }
  | { kind: "deposit"; caller: string; amount: Decimal }
  | { kind: "withdraw"; caller: string; amount: Decimal };

export type MismatchCode =
  | "operation_count"
  | "operation_type"
  | "source"
  | "contract"
  | "function"
  | "arg_count"
  | "arg_type"
  | "arg_value"
  | "auth_missing"
  | "auth_address"
  | "auth_root"
  | "auth_sub_invocation"
  | "fee"
  | "invalid_intent";

export interface Mismatch {
  code: MismatchCode;
  /** Dotted path of the checked field, e.g. "args.strike". */
  field: string;
  expected: string;
  actual: string;
}

export interface IntentVerification {
  ok: boolean;
  mismatches: Mismatch[];
}

export interface VerifyOptions {
  contracts: Partial<ZenithContracts>;
  /**
   * Contracts that may legitimately appear as auth sub-invocations (e.g. the
   * collateral token's SAC for a vault deposit). Zenith's own contracts are
   * always allowed.
   */
  allowedSubContracts?: string[];
  /** Upper bound on the fee the user may be asked to sign, in stroops. */
  maxFeeStroops?: bigint;
}

// ── Expected call from intent ─────────────────────────────────────────────────

interface ExpectedArg {
  name: string;
  type: string;
  value: string | bigint;
}

interface ExpectedCall {
  contract: ZenithContractKind;
  fn: string;
  args: ExpectedArg[];
}

const address = (name: string, value: string): ExpectedArg => ({ name, type: "address", value });
const symbol = (name: string, value: string): ExpectedArg => ({ name, type: "symbol", value });
const u32 = (name: string, value: number): ExpectedArg => ({ name, type: "u32", value: BigInt(value) });
const u64 = (name: string, value: string): ExpectedArg => ({ name, type: "u64", value: BigInt(value) });
const fixed = (name: string, type: "u128" | "i128", value: Decimal): ExpectedArg => ({
  name,
  type,
  value: toBaseUnits(value, ZENITH_DECIMALS),
});

export function expectedCall(intent: TxIntent): ExpectedCall {
  switch (intent.kind) {
    case "open_position":
      return {
        contract: "market",
        fn: "open_position",
        args: [
          address("caller", intent.caller),
          symbol("underlying", intent.underlying),
          fixed("strike", "u128", intent.strike),
          u32("expiry_ledger", intent.expiryLedger),
          symbol("side", intent.side),
          symbol("direction", intent.direction),
          fixed("contracts", "u128", intent.contracts),
        ],
      };
    case "close_position":
      return {
        contract: "market",
        fn: "close_position",
        args: [address("caller", intent.caller), u64("position_id", intent.positionId)],
      };
    case "roll_position":
      return {
        contract: "market",
        fn: "roll_position",
        args: [
          address("caller", intent.caller),
          u64("position_id", intent.positionId),
          fixed("new_strike", "u128", intent.newStrike),
          u32("new_expiry_ledger", intent.newExpiryLedger),
        ],
      };
    case "deposit":
    case "withdraw":
      return {
        contract: "vault",
        fn: intent.kind,
        args: [address("caller", intent.caller), fixed("amount", "i128", intent.amount)],
      };
  }
}

// ── Comparison ────────────────────────────────────────────────────────────────

const show = (v: unknown): string => (v === undefined || v === null ? "∅" : String(v));

function sameInvocation(a: DecodedInvocation, b: DecodedInvocation): boolean {
  return (
    a.contractId === b.contractId &&
    a.fn === b.fn &&
    a.args.length === b.args.length &&
    a.args.every((arg, i) => arg.scType === b.args[i].scType && arg.full === b.args[i].full)
  );
}

function checkInvocation(inv: DecodedInvocation, call: ExpectedCall, opts: VerifyOptions, out: Mismatch[]): void {
  const contractId = opts.contracts[call.contract];
  if (!contractId || inv.contractId !== contractId) {
    out.push({ code: "contract", field: "contract", expected: show(contractId), actual: inv.contractId });
  }
  if (inv.fn !== call.fn) {
    out.push({ code: "function", field: "function", expected: call.fn, actual: inv.fn });
  }
  if (inv.args.length !== call.args.length) {
    out.push({ code: "arg_count", field: "args", expected: String(call.args.length), actual: String(inv.args.length) });
  }
  call.args.forEach((want, i) => {
    const got = inv.args[i];
    if (!got) return; // already reported as arg_count
    if (got.scType !== want.type) {
      out.push({ code: "arg_type", field: `args.${want.name}`, expected: want.type, actual: got.scType });
      return;
    }
    if (got.value !== want.value) {
      out.push({ code: "arg_value", field: `args.${want.name}`, expected: show(want.value), actual: show(got.value) });
    }
  });
}

function checkSubInvocations(node: DecodedAuthNode, allowed: Set<string>, path: string, out: Mismatch[]): void {
  node.subInvocations.forEach((sub, i) => {
    const subPath = `${path}.sub[${i}]`;
    if (sub.fn.kind !== "contract") {
      out.push({ code: "auth_sub_invocation", field: subPath, expected: "contract call", actual: sub.fn.kind });
    } else if (!allowed.has(sub.fn.invocation.contractId)) {
      out.push({
        code: "auth_sub_invocation",
        field: subPath,
        expected: "Zenith or allow-listed contract",
        actual: `${sub.fn.invocation.contractId}.${sub.fn.invocation.fn}`,
      });
    }
    checkSubInvocations(sub, allowed, subPath, out);
  });
}

/**
 * Verifies that `decoded` does exactly what `intent` describes and nothing
 * more. Returns every mismatch found (not just the first) so the dialog and
 * the monitoring report show the full picture.
 */
export function verifyIntent(decoded: DecodedTransaction, intent: TxIntent, opts: VerifyOptions): IntentVerification {
  const mismatches: Mismatch[] = [];

  let call: ExpectedCall;
  try {
    call = expectedCall(intent);
  } catch (err) {
    mismatches.push({ code: "invalid_intent", field: "intent", expected: "valid intent", actual: (err as Error).message });
    return { ok: false, mismatches };
  }

  if (decoded.source !== intent.caller) {
    mismatches.push({ code: "source", field: "source", expected: intent.caller, actual: decoded.source });
  }

  if (opts.maxFeeStroops !== undefined && decoded.fees.totalStroops > opts.maxFeeStroops) {
    mismatches.push({
      code: "fee",
      field: "fees.total",
      expected: `≤ ${opts.maxFeeStroops.toString()}`,
      actual: decoded.fees.totalStroops.toString(),
    });
  }

  if (decoded.operations.length !== 1) {
    mismatches.push({ code: "operation_count", field: "operations", expected: "1", actual: String(decoded.operations.length) });
  }

  const op = decoded.operations[0];
  if (!op) return { ok: false, mismatches };

  if (op.source !== null && op.source !== intent.caller) {
    mismatches.push({ code: "source", field: "operations[0].source", expected: intent.caller, actual: op.source });
  }

  if (!op.invocation) {
    mismatches.push({ code: "operation_type", field: "operations[0].type", expected: "invokeContract", actual: op.type });
    return { ok: false, mismatches };
  }

  checkInvocation(op.invocation, call, opts, mismatches);

  // Authorization: the caller must authorize exactly this call, and any
  // nested calls may only touch Zenith's own (or allow-listed) contracts.
  if (op.auth.length === 0) {
    mismatches.push({ code: "auth_missing", field: "auth", expected: "authorization for caller", actual: "none" });
  }
  const allowed = new Set<string>([
    ...Object.values(opts.contracts).filter((id): id is string => !!id),
    ...(opts.allowedSubContracts ?? []),
  ]);
  op.auth.forEach((entry, i) => {
    const path = `auth[${i}]`;
    if (entry.credentials === "address" && entry.address !== intent.caller) {
      mismatches.push({ code: "auth_address", field: `${path}.address`, expected: intent.caller, actual: show(entry.address) });
    }
    const root = entry.root.fn;
    if (root.kind !== "contract" || !sameInvocation(root.invocation, op.invocation!)) {
      mismatches.push({
        code: "auth_root",
        field: `${path}.root`,
        expected: `${op.invocation!.contractId}.${op.invocation!.fn}`,
        actual: root.kind === "contract" ? `${root.invocation.contractId}.${root.invocation.fn}` : root.kind,
      });
    }
    checkSubInvocations(entry.root, allowed, path, mismatches);
  });

  return { ok: mismatches.length === 0, mismatches };
}
