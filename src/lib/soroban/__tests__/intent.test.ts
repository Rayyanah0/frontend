/**
 * Comparator unit tests (#119) — 100% statement/branch/function/line
 * coverage of src/lib/soroban/intent.ts, enforced by jest.config.js
 * coverageThreshold. Uses hand-built DecodedTransaction objects so every
 * branch can be reached precisely; the fixture-XDR tests live in
 * decode.test.ts.
 */

import { expectedCall, verifyIntent, type TxIntent, type VerifyOptions } from "../intent";
import type { DecodedArg, DecodedAuthEntry, DecodedAuthNode, DecodedInvocation, DecodedTransaction } from "../decode";

const USER = "GUSER";
const EVIL = "GEVIL";
const MARKET = "CMARKET";
const VAULT = "CVAULT";
const TOKEN = "CTOKEN";
const opts: VerifyOptions = { contracts: { market: MARKET, vault: VAULT, oracle: "" } };

const arg = (name: string, scType: string, value: unknown): DecodedArg => ({
  name,
  label: name,
  scType,
  typeMismatch: false,
  value,
  display: String(value),
  full: String(value),
});

const inv = (contractId: string, fn: string, args: DecodedArg[]): DecodedInvocation => ({
  contractId,
  contractKind: null,
  contractLabel: contractId,
  fn,
  summary: null,
  known: true,
  args,
});

const node = (invocation: DecodedInvocation, subInvocations: DecodedAuthNode[] = []): DecodedAuthNode => ({
  fn: { kind: "contract", invocation },
  subInvocations,
});

const sourceAuth = (root: DecodedAuthNode): DecodedAuthEntry => ({
  credentials: "source_account",
  address: null,
  nonce: null,
  signatureExpirationLedger: null,
  root,
});

const OPEN: TxIntent = {
  kind: "open_position",
  caller: USER,
  underlying: "XLM",
  strike: "0.125",
  expiryLedger: 100,
  side: "call",
  direction: "long",
  contracts: 10,
};

const openArgs = () => [
  arg("caller", "address", USER),
  arg("underlying", "symbol", "XLM"),
  arg("strike", "u128", 1_250_000n),
  arg("expiry_ledger", "u32", 100n),
  arg("side", "symbol", "call"),
  arg("direction", "symbol", "long"),
  arg("contracts", "u128", 100_000_000n),
];

function tx(invocation: DecodedInvocation | null, overrides: Partial<DecodedTransaction> = {}, auth?: DecodedAuthEntry[]): DecodedTransaction {
  return {
    hash: "h",
    source: USER,
    sequence: "1",
    fees: { totalStroops: 1000n, resourceStroops: 900n, inclusionStroops: 100n, totalXlm: "0.0001" },
    memo: null,
    timeBounds: null,
    feeBump: false,
    warnings: [],
    operations: [
      {
        index: 0,
        type: invocation ? "invokeHostFunction" : "payment",
        source: null,
        invocation,
        auth: auth ?? (invocation ? [sourceAuth(node(invocation))] : []),
        rawXdr: "",
      },
    ],
    ...overrides,
  };
}

const openTx = (argsOverride?: DecodedArg[], auth?: DecodedAuthEntry[]) =>
  tx(inv(MARKET, "open_position", argsOverride ?? openArgs()), {}, auth);

const codes = (t: DecodedTransaction, intent: TxIntent = OPEN, o: VerifyOptions = opts) =>
  verifyIntent(t, intent, o).mismatches.map((m) => `${m.code}:${m.field}`);

describe("expectedCall", () => {
  it("maps every intent kind to contract, function, and base-unit args", () => {
    expect(expectedCall(OPEN)).toMatchObject({ contract: "market", fn: "open_position" });
    expect(expectedCall({ kind: "close_position", caller: USER, positionId: "7" }).args[1]).toEqual({ name: "position_id", type: "u64", value: 7n });
    expect(expectedCall({ kind: "roll_position", caller: USER, positionId: "7", newStrike: 2, newExpiryLedger: 5 }).args.map((a) => a.value))
      .toEqual([USER, 7n, 20_000_000n, 5n]);
    expect(expectedCall({ kind: "deposit", caller: USER, amount: "1.5" })).toMatchObject({ contract: "vault", fn: "deposit" });
    expect(expectedCall({ kind: "withdraw", caller: USER, amount: 1 }).args[1]).toEqual({ name: "amount", type: "i128", value: 10_000_000n });
  });
});

describe("verifyIntent", () => {
  it("accepts a faithful transaction", () => {
    expect(verifyIntent(openTx(), OPEN, opts)).toEqual({ ok: true, mismatches: [] });
  });

  it("accepts each intent kind", () => {
    const close = inv(MARKET, "close_position", [arg("caller", "address", USER), arg("position_id", "u64", 7n)]);
    expect(verifyIntent(tx(close), { kind: "close_position", caller: USER, positionId: "7" }, opts).ok).toBe(true);
    const roll = inv(MARKET, "roll_position", [
      arg("caller", "address", USER), arg("position_id", "u64", 7n), arg("new_strike", "u128", 20_000_000n), arg("new_expiry_ledger", "u32", 5n),
    ]);
    expect(verifyIntent(tx(roll), { kind: "roll_position", caller: USER, positionId: "7", newStrike: 2, newExpiryLedger: 5 }, opts).ok).toBe(true);
    const deposit = inv(VAULT, "deposit", [arg("caller", "address", USER), arg("amount", "i128", 15_000_000n)]);
    expect(verifyIntent(tx(deposit), { kind: "deposit", caller: USER, amount: "1.5" }, opts).ok).toBe(true);
  });

  it("rejects an intent that cannot be converted to base units", () => {
    const r = verifyIntent(openTx(), { ...OPEN, strike: "abc" } as TxIntent, opts);
    expect(r.ok).toBe(false);
    expect(r.mismatches[0]).toMatchObject({ code: "invalid_intent", field: "intent" });
  });

  it("rejects a different transaction source", () => {
    expect(codes(tx(inv(MARKET, "open_position", openArgs()), { source: EVIL }))).toEqual(["source:source"]);
  });

  it("enforces maxFeeStroops when given", () => {
    expect(codes(openTx(), OPEN, { ...opts, maxFeeStroops: 999n })).toEqual(["fee:fees.total"]);
    expect(codes(openTx(), OPEN, { ...opts, maxFeeStroops: 1000n })).toEqual([]);
  });

  it("rejects zero operations", () => {
    const r = verifyIntent(tx(null, { operations: [] }), OPEN, opts);
    expect(r).toEqual({ ok: false, mismatches: [expect.objectContaining({ code: "operation_count", actual: "0" })] });
  });

  it("rejects extra operations", () => {
    const t = openTx();
    t.operations.push({ ...t.operations[0], index: 1 });
    expect(codes(t)).toEqual(["operation_count:operations"]);
  });

  it("checks operation-level source overrides", () => {
    const t = openTx();
    t.operations[0].source = USER;
    expect(codes(t)).toEqual([]);
    t.operations[0].source = EVIL;
    expect(codes(t)).toEqual(["source:operations[0].source"]);
  });

  it("rejects a non-contract operation", () => {
    expect(codes(tx(null))).toEqual(["operation_type:operations[0].type"]);
  });

  it("rejects the wrong contract, including an unconfigured one", () => {
    expect(codes(tx(inv(EVIL, "open_position", openArgs())))).toContain("contract:contract");
    const r = verifyIntent(openTx(), OPEN, { contracts: {} });
    expect(r.mismatches[0]).toMatchObject({ code: "contract", expected: "∅" });
  });

  it("rejects the wrong function", () => {
    expect(codes(tx(inv(MARKET, "close_position", openArgs())))).toEqual(["function:function"]);
  });

  it("rejects missing and extra arguments", () => {
    const fewer = openArgs().slice(0, 6);
    expect(codes(openTx(fewer))).toEqual(["arg_count:args"]);
    const more = [...openArgs(), arg("extra", "u32", 1n)];
    expect(codes(openTx(more))).toEqual(["arg_count:args"]);
  });

  it("rejects wrong argument types without also reporting the value", () => {
    const args = openArgs();
    args[2] = arg("strike", "i128", 1_250_000n);
    expect(codes(openTx(args))).toEqual(["arg_type:args.strike"]);
  });

  it("rejects wrong argument values", () => {
    const args = openArgs();
    args[6] = arg("contracts", "u128", 1n);
    const r = verifyIntent(openTx(args), OPEN, opts);
    expect(r.mismatches).toEqual([{ code: "arg_value", field: "args.contracts", expected: "100000000", actual: "1" }]);
  });

  it("requires an authorization entry", () => {
    expect(codes(openTx(undefined, []))).toEqual(["auth_missing:auth"]);
  });

  it("accepts address credentials for the caller and rejects others", () => {
    const invocation = inv(MARKET, "open_position", openArgs());
    const own: DecodedAuthEntry = { ...sourceAuth(node(invocation)), credentials: "address", address: USER, nonce: "1", signatureExpirationLedger: 9 };
    expect(codes(openTx(undefined, [own]))).toEqual([]);
    expect(codes(openTx(undefined, [{ ...own, address: EVIL }]))).toEqual(["auth_address:auth[0].address"]);
    const r = verifyIntent(openTx(undefined, [{ ...own, address: null }]), OPEN, opts);
    expect(r.mismatches[0]).toMatchObject({ code: "auth_address", actual: "∅" });
  });

  describe("auth root must be exactly the top-level call", () => {
    const root = (i: DecodedInvocation) => [sourceAuth(node(i))];
    const mutated = (mutate: (args: DecodedArg[]) => void) => {
      const args = openArgs();
      mutate(args);
      return args;
    };

    it.each([
      ["different contract", inv(EVIL, "open_position", openArgs())],
      ["different function", inv(MARKET, "roll_position", openArgs())],
      ["different arg count", inv(MARKET, "open_position", openArgs().slice(0, 3))],
      ["different arg type", inv(MARKET, "open_position", mutated((a) => { a[2] = { ...a[2], scType: "i128" }; }))],
      ["different arg value", inv(MARKET, "open_position", mutated((a) => { a[2] = { ...a[2], full: "9" }; }))],
    ])("%s", (_name, rootInv) => {
      expect(codes(openTx(undefined, root(rootInv)))).toEqual(["auth_root:auth[0].root"]);
    });

    it("rejects a create-contract root", () => {
      const entry = sourceAuth({ fn: { kind: "create_contract", description: "deploy" }, subInvocations: [] });
      const r = verifyIntent(openTx(undefined, [entry]), OPEN, opts);
      expect(r.mismatches).toEqual([expect.objectContaining({ code: "auth_root", actual: "create_contract" })]);
    });
  });

  describe("sub-invocations", () => {
    const withSubs = (subs: DecodedAuthNode[], o: VerifyOptions = opts) => {
      const invocation = inv(MARKET, "open_position", openArgs());
      return codes(openTx(undefined, [sourceAuth(node(invocation, subs))]), OPEN, o);
    };
    const transfer = (contract: string, subs: DecodedAuthNode[] = []) => node(inv(contract, "transfer", []), subs);

    it("allows Zenith contracts", () => {
      expect(withSubs([transfer(VAULT)])).toEqual([]);
    });

    it("allows explicitly allow-listed contracts", () => {
      expect(withSubs([transfer(TOKEN)], { ...opts, allowedSubContracts: [TOKEN] })).toEqual([]);
    });

    it("rejects unknown contracts, recursing into nested trees", () => {
      expect(withSubs([transfer(VAULT, [transfer(EVIL)])])).toEqual(["auth_sub_invocation:auth[0].sub[0].sub[0]"]);
      expect(withSubs([transfer(TOKEN)])).toEqual(["auth_sub_invocation:auth[0].sub[0]"]);
    });

    it("rejects nested contract deployments", () => {
      expect(withSubs([{ fn: { kind: "create_contract", description: "deploy" }, subInvocations: [] }]))
        .toEqual(["auth_sub_invocation:auth[0].sub[0]"]);
    });
  });
});
