/**
 * Deterministic fixture transactions for the clear-signing tests (#119).
 *
 * Built with the real stellar-sdk (the test files un-mock it) from fixed
 * keys and contract ids, so every run produces byte-identical XDR. Each
 * "tampered" fixture models a specific attack: the transaction the wallet
 * would be asked to sign differs from what the user asked for.
 */

import {
  Account,
  Keypair,
  Operation,
  SorobanDataBuilder,
  StrKey,
  TimeoutInfinite,
  TransactionBuilder,
  Networks,
  nativeToScVal,
  xdr,
  Address,
  Asset,
  type Transaction,
} from "@stellar/stellar-sdk";
import { ZenithMarketContract, ZenithVaultContract } from "../contracts";
import type { ZenithContracts } from "../networks";
import type { TxIntent } from "../intent";

export const PASSPHRASE = Networks.TESTNET;

export const userKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1));
export const attackerKey = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 9));
export const USER = userKey.publicKey();
export const ATTACKER = attackerKey.publicKey();

export const CONTRACTS: ZenithContracts = {
  market: StrKey.encodeContract(Buffer.alloc(32, 2)),
  vault: StrKey.encodeContract(Buffer.alloc(32, 3)),
  oracle: StrKey.encodeContract(Buffer.alloc(32, 4)),
};
export const TOKEN_SAC = StrKey.encodeContract(Buffer.alloc(32, 5));
export const EVIL_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 6));

export const RESOURCE_FEE = 123_456;
export const INCLUSION_FEE = 100;

export const OPEN_INTENT: Extract<TxIntent, { kind: "open_position" }> = {
  kind: "open_position",
  caller: USER,
  underlying: "XLM",
  strike: "0.125",
  expiryLedger: 1_234_567,
  side: "call",
  direction: "long",
  contracts: 10,
};

export const WITHDRAW_INTENT: Extract<TxIntent, { kind: "withdraw" }> = {
  kind: "withdraw",
  caller: USER,
  amount: "250.5",
};

// ── Builders ──────────────────────────────────────────────────────────────────

const market = new ZenithMarketContract(CONTRACTS.market);
const vault = new ZenithVaultContract(CONTRACTS.vault);

function invokeArgsOf(op: xdr.Operation): xdr.InvokeContractArgs {
  return op.body().invokeHostFunctionOp().hostFunction().invokeContract();
}

function authorizedCall(args: xdr.InvokeContractArgs, subInvocations: xdr.SorobanAuthorizedInvocation[] = []): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(args),
    subInvocations,
  });
}

function contractCall(contractId: string, fn: string, args: xdr.ScVal[]): xdr.InvokeContractArgs {
  return new xdr.InvokeContractArgs({
    contractAddress: Address.fromString(contractId).toScAddress(),
    functionName: fn,
    args,
  });
}

function sourceAuth(root: xdr.SorobanAuthorizedInvocation): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: root,
  });
}

function addressAuth(address: string, root: xdr.SorobanAuthorizedInvocation): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(address).toScAddress(),
        nonce: xdr.Int64.fromString("42"),
        signatureExpirationLedger: 1_300_000,
        signature: xdr.ScVal.scvVoid(),
      })
    ),
    rootInvocation: root,
  });
}

interface BuildOptions {
  source?: string;
  auth?: (call: xdr.InvokeContractArgs) => xdr.SorobanAuthorizationEntry[];
  extraOps?: xdr.Operation[];
}

/** Wraps a contract-call operation in an assembled-looking Soroban tx (resource fee + auth). */
export function buildTx(op: xdr.Operation, opts: BuildOptions = {}): string {
  const call = invokeArgsOf(op);
  const auth = opts.auth ? opts.auth(call) : [sourceAuth(authorizedCall(call))];
  const builder = new TransactionBuilder(new Account(opts.source ?? USER, "100"), {
    fee: String(INCLUSION_FEE + RESOURCE_FEE),
    networkPassphrase: PASSPHRASE,
  })
    .addOperation(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(call), auth }))
    .setSorobanData(new SorobanDataBuilder().setResourceFee(RESOURCE_FEE).build())
    .setTimeout(TimeoutInfinite);
  for (const extra of opts.extraOps ?? []) builder.addOperation(extra);
  return builder.build().toXDR();
}

export function openOp(overrides: Partial<Parameters<ZenithMarketContract["openPosition"]>[0]> = {}): xdr.Operation {
  return market.openPosition({
    caller: USER,
    underlying: "XLM",
    strike: 1_250_000n, // 0.125 @ 7dp
    expiryLedger: 1_234_567,
    side: "call",
    direction: "long",
    contracts: 100_000_000n, // 10 @ 7dp
    ...overrides,
  });
}

export function withdrawOp(caller = USER, amount = 2_505_000_000n): xdr.Operation {
  return vault.withdraw({ caller, amount });
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

export const fixtures = {
  /** Faithful open_position — must verify. */
  open: () => buildTx(openOp()),
  /** Faithful withdraw with a nested token transfer sub-invocation. */
  withdrawWithTransfer: () =>
    buildTx(withdrawOp(), {
      auth: (call) => [
        sourceAuth(
          authorizedCall(call, [
            authorizedCall(contractCall(TOKEN_SAC, "transfer", [
              nativeToScVal(CONTRACTS.vault, { type: "address" }),
              nativeToScVal(USER, { type: "address" }),
              nativeToScVal(2_505_000_000n, { type: "i128" }),
            ])),
          ])
        ),
      ],
    }),

  // Tampered ────────────────────────────────────────────────────────────────
  /** Strike swapped between intent and build. */
  tamperedStrike: () => buildTx(openOp({ strike: 9_990_000n })),
  /** Side flipped call → put. */
  tamperedSide: () => buildTx(openOp({ side: "put" })),
  /** Size inflated 10 → 1000 contracts. */
  tamperedSize: () => buildTx(openOp({ contracts: 10_000_000_000n })),
  /** Withdrawal recipient (caller) swapped to the attacker. */
  tamperedRecipient: () => buildTx(withdrawOp(ATTACKER), { source: ATTACKER }),
  /** Call routed to a look-alike contract. */
  tamperedContract: () =>
    buildTx(new ZenithMarketContract(EVIL_CONTRACT).openPosition({
      caller: USER, underlying: "XLM", strike: 1_250_000n, expiryLedger: 1_234_567, side: "call", direction: "long", contracts: 100_000_000n,
    })),
  /** Top-level call is faithful but the auth entry authorizes something else. */
  tamperedAuthRoot: () =>
    buildTx(openOp(), {
      auth: () => [sourceAuth(authorizedCall(invokeArgsOf(openOp({ contracts: 10_000_000_000n }))))],
    }),
  /** Faithful call, with a hidden nested transfer to the attacker. */
  tamperedSubInvocation: () =>
    buildTx(withdrawOp(), {
      auth: (call) => [
        sourceAuth(
          authorizedCall(call, [
            authorizedCall(contractCall(EVIL_CONTRACT, "transfer", [
              nativeToScVal(USER, { type: "address" }),
              nativeToScVal(ATTACKER, { type: "address" }),
              nativeToScVal(170_141_183_460_469_231_731_687_303_715_884_105_727n, { type: "i128" }),
            ])),
          ])
        ),
      ],
    }),
  /** Faithful call plus an appended payment draining XLM to the attacker. */
  tamperedExtraPayment: () =>
    buildTx(openOp(), {
      extraOps: [Operation.payment({ destination: ATTACKER, asset: Asset.native(), amount: "1000" })],
    }),
  /** Auth signed for a different address (foreign credentials). */
  foreignAddressAuth: () => buildTx(openOp(), { auth: (call) => [addressAuth(ATTACKER, authorizedCall(call))] }),
  /** Strike encoded as i128 instead of the spec's u128. */
  wrongArgType: () => {
    const call = contractCall(CONTRACTS.market, "open_position", [
      nativeToScVal(USER, { type: "address" }),
      xdr.ScVal.scvSymbol("XLM"),
      nativeToScVal(1_250_000n, { type: "i128" }),
      xdr.ScVal.scvU32(1_234_567),
      xdr.ScVal.scvSymbol("call"),
      xdr.ScVal.scvSymbol("long"),
      nativeToScVal(100_000_000n, { type: "u128" }),
    ]);
    return buildTx(Operation.invokeHostFunction({ func: xdr.HostFunction.hostFunctionTypeInvokeContract(call), auth: [] }));
  },
  /** Call to a contract the app doesn't know. */
  unknownContract: () =>
    buildTx(Operation.invokeHostFunction({
      func: xdr.HostFunction.hostFunctionTypeInvokeContract(
        contractCall(EVIL_CONTRACT, "mystery", [nativeToScVal(-5n, { type: "i128" }), nativeToScVal({ a: 1 })])
      ),
      auth: [],
    })),
};

/** Fee-bump wrapper around an inner fixture, signed by the user. */
export function feeBump(innerXdr: string): string {
  const inner = TransactionBuilder.fromXDR(innerXdr, PASSPHRASE) as Transaction;
  inner.sign(userKey);
  return TransactionBuilder.buildFeeBumpTransaction(userKey, String(INCLUSION_FEE + RESOURCE_FEE), inner, PASSPHRASE).toXDR();
}

/** Signs an XDR as the wallet would. */
export function sign(envelopeXdr: string): string {
  const tx = TransactionBuilder.fromXDR(envelopeXdr, PASSPHRASE) as Transaction;
  tx.sign(userKey);
  return tx.toXDR();
}
