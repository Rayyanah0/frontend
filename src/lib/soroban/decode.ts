/**
 * Clear-signing decoder — Issue #119.
 *
 * Decodes a *final, assembled* transaction XDR (post-simulation, exactly the
 * bytes the wallet will be asked to sign) into a human-readable structure:
 * operations, contract invocations with typed/named arguments, Soroban
 * authorization trees, and fees.
 *
 * Decoding the assembled XDR rather than the pre-build params is the point:
 * a compromised dependency, RPC, or API that rewrites the transaction between
 * "what the user asked for" and "what gets signed" shows up here, and the
 * comparator in ./intent.ts blocks it.
 *
 * Unknown contracts are decoded generically (raw ScVal types and values) and
 * flagged with a warning rather than hidden.
 */

import {
  Address,
  FeeBumpTransaction,
  TransactionBuilder,
  scValToNative,
  xdr,
  type Transaction,
} from "@stellar/stellar-sdk";
import type { ZenithContracts } from "./networks";
import {
  CONTRACT_LABELS,
  lookupFunction,
  type SpecArg,
  type SpecType,
  type ZenithContractKind,
} from "./contracts/spec";
import { formatBaseUnits, shortenAddress } from "./units";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DecodedArg {
  /** Spec name (e.g. "strike"), or "arg0".. for unknown functions. */
  name: string;
  label: string;
  /** ScVal type actually present in the XDR, e.g. "u128", "address", "vec". */
  scType: string;
  /** Type the spec expects, if the function is known. */
  expectedType?: SpecType;
  /** True when the XDR type differs from the spec type. */
  typeMismatch: boolean;
  /**
   * Canonical comparable value: bigint for integers, string for addresses /
   * symbols / strings, boolean for bools; generic native value otherwise.
   */
  value: unknown;
  /** Human rendering (amounts in asset decimals, shortened addresses). */
  display: string;
  /** Full value for copy-to-clipboard (addresses, big integers). */
  full: string;
  unit?: SpecArg["unit"];
}

export interface DecodedInvocation {
  contractId: string;
  /** Which Zenith contract this is, or null for unknown contracts. */
  contractKind: ZenithContractKind | null;
  contractLabel: string;
  fn: string;
  /** Spec summary, e.g. "Open an option position". */
  summary: string | null;
  /** True when both the contract and the function are in the Zenith spec. */
  known: boolean;
  args: DecodedArg[];
}

export type DecodedAuthFunction =
  | { kind: "contract"; invocation: DecodedInvocation }
  | { kind: "create_contract"; description: string };

export interface DecodedAuthNode {
  fn: DecodedAuthFunction;
  subInvocations: DecodedAuthNode[];
}

export interface DecodedAuthEntry {
  /**
   * "source_account": authorized implicitly by the transaction signature.
   * "address": a separately signed authorization for `address`.
   */
  credentials: "source_account" | "address";
  address: string | null;
  nonce: string | null;
  signatureExpirationLedger: number | null;
  root: DecodedAuthNode;
}

export interface DecodedOperation {
  index: number;
  /** SDK operation type, e.g. "invokeHostFunction", "payment". */
  type: string;
  /** Operation-level source override, if any. */
  source: string | null;
  invocation: DecodedInvocation | null;
  auth: DecodedAuthEntry[];
  /** Base64 operation XDR (for the raw-data view). */
  rawXdr: string;
}

export interface DecodedFees {
  /** Max total fee the signer authorizes (inclusion + resource), in stroops. */
  totalStroops: bigint;
  /** Soroban resource fee declared in the transaction data, in stroops. */
  resourceStroops: bigint;
  /** totalStroops - resourceStroops. */
  inclusionStroops: bigint;
  totalXlm: string;
}

export interface DecodedTransaction {
  hash: string;
  source: string;
  sequence: string;
  fees: DecodedFees;
  memo: string | null;
  timeBounds: { minTime: string; maxTime: string } | null;
  operations: DecodedOperation[];
  /** True when the envelope was a fee bump (the inner tx is decoded). */
  feeBump: boolean;
  warnings: DecodeWarning[];
}

export interface DecodeWarning {
  code: "unknown_contract" | "unknown_function" | "type_mismatch" | "non_contract_operation" | "foreign_auth" | "undecodable_value";
  message: string;
}

export interface DecodeOptions {
  /** Deployed Zenith contract ids for the active network. */
  contracts: Partial<ZenithContracts>;
  /** Extra contracts to label by name (e.g. collateral token SAC). */
  labels?: Record<string, string>;
}

// ── ScVal decoding ────────────────────────────────────────────────────────────

const SCV_TYPE_NAMES: Record<string, string> = {
  scvBool: "bool",
  scvVoid: "void",
  scvError: "error",
  scvU32: "u32",
  scvI32: "i32",
  scvU64: "u64",
  scvI64: "i64",
  scvTimepoint: "timepoint",
  scvDuration: "duration",
  scvU128: "u128",
  scvI128: "i128",
  scvU256: "u256",
  scvI256: "i256",
  scvBytes: "bytes",
  scvString: "string",
  scvSymbol: "symbol",
  scvVec: "vec",
  scvMap: "map",
  scvAddress: "address",
  scvContractInstance: "instance",
  scvLedgerKeyContractInstance: "instance_key",
  scvLedgerKeyNonce: "nonce_key",
};

export function scValTypeName(val: xdr.ScVal): string {
  const name = val.switch().name;
  return SCV_TYPE_NAMES[name] ?? name;
}

const toHex = (bytes: ArrayLike<number>): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/** JSON-safe rendering of an arbitrary native value (bigint → string). */
function stringifyNative(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "bigint" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "void";
  try {
    return JSON.stringify(value, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (v instanceof Uint8Array) return `0x${toHex(v)}`;
      if (v && typeof v === "object" && v.type === "Buffer" && Array.isArray(v.data)) {
        return `0x${toHex(v.data)}`;
      }
      return v;
    });
  } catch {
    return String(value);
  }
}

interface NativeValue {
  scType: string;
  value: unknown;
  full: string;
}

function decodeScVal(val: xdr.ScVal): NativeValue {
  const scType = scValTypeName(val);
  if (scType === "address") {
    const address = Address.fromScVal(val).toString();
    return { scType, value: address, full: address };
  }
  if (scType === "symbol") {
    const symbol = val.sym().toString();
    return { scType, value: symbol, full: symbol };
  }
  const native = scValToNative(val);
  // Normalise every integer width to bigint so comparisons are exact.
  const value = typeof native === "number" && scType !== "bool" ? BigInt(native) : native;
  return { scType, value, full: stringifyNative(value) };
}

function renderArg(native: NativeValue, spec: SpecArg | undefined): string {
  const { value, scType } = native;
  if (scType === "address" && typeof value === "string") return shortenAddress(value);
  if (spec?.decimals !== undefined && typeof value === "bigint") {
    const text = formatBaseUnits(value, spec.decimals);
    return spec.symbol ? `${text} ${spec.symbol}` : text;
  }
  if (spec?.unit === "ledger" && typeof value === "bigint") return `#${value.toString()}`;
  if (typeof value === "bigint") return formatBaseUnits(value, 0);
  const text = stringifyNative(value);
  return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}

// ── Invocation decoding ───────────────────────────────────────────────────────

function contractKindOf(contractId: string, opts: DecodeOptions): ZenithContractKind | null {
  for (const kind of ["market", "vault", "oracle"] as const) {
    if (opts.contracts[kind] && opts.contracts[kind] === contractId) return kind;
  }
  return null;
}

export function decodeInvocation(
  contractAddress: xdr.ScAddress,
  functionName: string | Buffer,
  args: xdr.ScVal[],
  opts: DecodeOptions,
  warnings: DecodeWarning[] = []
): DecodedInvocation {
  const contractId = Address.fromScAddress(contractAddress).toString();
  const fn = functionName.toString();
  const contractKind = contractKindOf(contractId, opts);
  const spec = contractKind ? lookupFunction(contractKind, fn) : null;

  if (!contractKind) {
    warnings.push({
      code: "unknown_contract",
      message: `Call to unrecognised contract ${shortenAddress(contractId)} (${fn}) — review the raw data carefully.`,
    });
  } else if (!spec) {
    warnings.push({
      code: "unknown_function",
      message: `${CONTRACT_LABELS[contractKind]} function "${fn}" is not in the bindings spec.`,
    });
  }

  const decodedArgs = args.map((arg, i): DecodedArg => {
    const specArg = spec?.args[i];
    let native: NativeValue;
    try {
      native = decodeScVal(arg);
    } catch {
      warnings.push({ code: "undecodable_value", message: `Argument ${i} of ${fn} could not be decoded.` });
      native = { scType: scValTypeName(arg), value: arg.toXDR("base64"), full: arg.toXDR("base64") };
    }
    const typeMismatch = !!specArg && specArg.type !== native.scType;
    if (typeMismatch) {
      warnings.push({
        code: "type_mismatch",
        message: `${fn}.${specArg!.name}: expected ${specArg!.type}, transaction contains ${native.scType}.`,
      });
    }
    return {
      name: specArg?.name ?? `arg${i}`,
      label: specArg?.label ?? `Argument ${i + 1}`,
      scType: native.scType,
      expectedType: specArg?.type,
      typeMismatch,
      value: native.value,
      display: renderArg(native, typeMismatch ? undefined : specArg),
      full: native.full,
      unit: specArg?.unit,
    };
  });

  return {
    contractId,
    contractKind,
    contractLabel: contractKind ? CONTRACT_LABELS[contractKind] : opts.labels?.[contractId] ?? "Unknown contract",
    fn,
    summary: spec?.summary ?? null,
    known: !!spec,
    args: decodedArgs,
  };
}

// ── Auth decoding ─────────────────────────────────────────────────────────────

function decodeAuthNode(node: xdr.SorobanAuthorizedInvocation, opts: DecodeOptions, warnings: DecodeWarning[]): DecodedAuthNode {
  const fn = node.function();
  let decodedFn: DecodedAuthFunction;
  if (fn.switch().name === "sorobanAuthorizedFunctionTypeContractFn") {
    const call = fn.contractFn();
    decodedFn = {
      kind: "contract",
      invocation: decodeInvocation(call.contractAddress(), call.functionName(), call.args(), opts, warnings),
    };
  } else {
    decodedFn = { kind: "create_contract", description: "Deploy a new contract instance" };
  }
  return {
    fn: decodedFn,
    subInvocations: node.subInvocations().map((sub) => decodeAuthNode(sub, opts, warnings)),
  };
}

export function decodeAuthEntry(entry: xdr.SorobanAuthorizationEntry, opts: DecodeOptions, warnings: DecodeWarning[] = []): DecodedAuthEntry {
  const creds = entry.credentials();
  const root = decodeAuthNode(entry.rootInvocation(), opts, warnings);
  if (creds.switch().name === "sorobanCredentialsAddress") {
    const addressCreds = creds.address();
    return {
      credentials: "address",
      address: Address.fromScAddress(addressCreds.address()).toString(),
      nonce: addressCreds.nonce().toString(),
      signatureExpirationLedger: addressCreds.signatureExpirationLedger(),
      root,
    };
  }
  return { credentials: "source_account", address: null, nonce: null, signatureExpirationLedger: null, root };
}

// ── Transaction decoding ──────────────────────────────────────────────────────

const STROOPS_PER_XLM = 10_000_000n;

function decodeFees(tx: Transaction): DecodedFees {
  const totalStroops = BigInt(tx.fee);
  let resourceStroops = 0n;
  try {
    const ext = tx.toEnvelope().v1().tx().ext();
    if (ext.switch() === 1) resourceStroops = BigInt(ext.sorobanData().resourceFee().toString());
  } catch {
    // Classic transaction without Soroban data.
  }
  return {
    totalStroops,
    resourceStroops,
    inclusionStroops: totalStroops - resourceStroops,
    totalXlm: formatBaseUnits(totalStroops, 7),
  };
}

function rawOperationXdrs(tx: Transaction): string[] {
  try {
    return tx.toEnvelope().v1().tx().operations().map((op) => op.toXDR("base64"));
  } catch {
    return [];
  }
}

function decodeOperation(
  op: Transaction["operations"][number],
  index: number,
  rawXdr: string,
  opts: DecodeOptions,
  warnings: DecodeWarning[]
): DecodedOperation {
  if (op.type !== "invokeHostFunction") {
    warnings.push({
      code: "non_contract_operation",
      message: `Operation ${index + 1} is a "${op.type}" operation, not a contract call.`,
    });
    return { index, type: op.type, source: op.source ?? null, invocation: null, auth: [], rawXdr };
  }

  const func = op.func;
  let invocation: DecodedInvocation | null = null;
  if (func.switch().name === "hostFunctionTypeInvokeContract") {
    const call = func.invokeContract();
    invocation = decodeInvocation(call.contractAddress(), call.functionName(), call.args(), opts, warnings);
  } else {
    warnings.push({
      code: "non_contract_operation",
      message: `Operation ${index + 1} is a host function of type ${func.switch().name}, not a contract call.`,
    });
  }

  return {
    index,
    type: op.type,
    source: op.source ?? null,
    invocation,
    auth: (op.auth ?? []).map((entry) => decodeAuthEntry(entry, opts, warnings)),
    rawXdr,
  };
}

/**
 * Decodes a base64 transaction envelope. Throws if the XDR is malformed or
 * was built for a different network passphrase (hash would differ).
 */
export function decodeTransactionXdr(envelopeXdr: string, networkPassphrase: string, opts: DecodeOptions): DecodedTransaction {
  const parsed = TransactionBuilder.fromXDR(envelopeXdr, networkPassphrase);
  const feeBump = parsed instanceof FeeBumpTransaction;
  const tx = (feeBump ? (parsed as FeeBumpTransaction).innerTransaction : parsed) as Transaction;
  const warnings: DecodeWarning[] = [];

  const rawOps = rawOperationXdrs(tx);
  const operations = tx.operations.map((op, i) => decodeOperation(op, i, rawOps[i] ?? "", opts, warnings));

  for (const op of operations) {
    for (const entry of op.auth) {
      if (entry.credentials === "address" && entry.address !== tx.source) {
        warnings.push({
          code: "foreign_auth",
          message: `Operation ${op.index + 1} carries an authorization signed for ${shortenAddress(entry.address ?? "")}, not the transaction source.`,
        });
      }
    }
  }

  const memoValue = tx.memo?.value;
  return {
    hash: parsed.hash().toString("hex"),
    source: tx.source,
    sequence: tx.sequence,
    fees: decodeFees(tx),
    memo: tx.memo && tx.memo.type !== "none" && memoValue != null ? String(memoValue) : null,
    timeBounds: tx.timeBounds ? { minTime: tx.timeBounds.minTime, maxTime: tx.timeBounds.maxTime } : null,
    operations,
    feeBump,
    warnings,
  };
}

/** Flattens an auth tree depth-first — handy for display and for the comparator. */
export function flattenAuth(node: DecodedAuthNode, depth = 0): Array<{ depth: number; node: DecodedAuthNode }> {
  return [{ depth, node }, ...node.subInvocations.flatMap((sub) => flattenAuth(sub, depth + 1))];
}
