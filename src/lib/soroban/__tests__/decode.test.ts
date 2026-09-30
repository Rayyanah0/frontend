/**
 * @jest-environment node
 *
 * Clear-signing (#119): decode fixture XDRs with the real stellar-sdk and
 * verify that every tampered fixture is caught by the comparator.
 */

jest.mock("@stellar/stellar-sdk", () =>
  // The global moduleNameMapper stubs the SDK; these tests need real XDR.
  jest.requireActual(require("path").join(process.cwd(), "node_modules/@stellar/stellar-sdk"))
);
jest.mock("../../monitoring", () => ({
  captureError: jest.fn(() => Promise.resolve()),
  captureMessage: jest.fn(() => Promise.resolve()),
}));

import { decodeTransactionXdr, flattenAuth } from "../decode";
import { verifyIntent } from "../intent";
import { assertSignedMatchesReviewed, assertVerified, IntentMismatchError, reviewTransaction } from "../tx";
import { captureError, captureMessage } from "../../monitoring";
import {
  ATTACKER,
  CONTRACTS,
  EVIL_CONTRACT,
  INCLUSION_FEE,
  OPEN_INTENT,
  PASSPHRASE,
  RESOURCE_FEE,
  TOKEN_SAC,
  USER,
  WITHDRAW_INTENT,
  feeBump,
  fixtures,
  sign,
} from "../__fixtures__/transactions";

const opts = { contracts: CONTRACTS };
const decode = (x: string) => decodeTransactionXdr(x, PASSPHRASE, opts);

beforeEach(() => jest.clearAllMocks());

describe("decodeTransactionXdr", () => {
  it("decodes a Zenith open_position with named, typed, unit-rendered args", () => {
    const d = decode(fixtures.open());
    expect(d.source).toBe(USER);
    expect(d.feeBump).toBe(false);
    expect(d.warnings).toEqual([]);
    expect(d.operations).toHaveLength(1);

    const inv = d.operations[0].invocation!;
    expect(inv).toMatchObject({ contractId: CONTRACTS.market, contractKind: "market", fn: "open_position", known: true });
    expect(inv.contractLabel).toBe("Zenith Market");
    const byName = Object.fromEntries(inv.args.map((a) => [a.name, a]));
    expect(byName.caller).toMatchObject({ scType: "address", value: USER, full: USER });
    expect(byName.caller.display).toMatch(/^.{5}….{5}$/);
    expect(byName.underlying).toMatchObject({ scType: "symbol", value: "XLM", display: "XLM" });
    expect(byName.strike).toMatchObject({ scType: "u128", value: 1_250_000n, display: "0.125 USD" });
    expect(byName.expiry_ledger).toMatchObject({ scType: "u32", value: 1_234_567n, display: "#1234567" });
    expect(byName.side.value).toBe("call");
    expect(byName.direction.value).toBe("long");
    expect(byName.contracts).toMatchObject({ value: 100_000_000n, display: "10 contracts" });
  });

  it("decodes fees (inclusion vs resource)", () => {
    const { fees } = decode(fixtures.open());
    expect(fees.totalStroops).toBe(BigInt(INCLUSION_FEE + RESOURCE_FEE));
    expect(fees.resourceStroops).toBe(BigInt(RESOURCE_FEE));
    expect(fees.inclusionStroops).toBe(BigInt(INCLUSION_FEE));
    expect(fees.totalXlm).toBe("0.0123556");
  });

  it("decodes source-account auth entries", () => {
    const [entry] = decode(fixtures.open()).operations[0].auth;
    expect(entry.credentials).toBe("source_account");
    expect(entry.address).toBeNull();
    expect(entry.root.fn.kind).toBe("contract");
  });

  it("decodes nested auth trees with sub-invocations", () => {
    const d = decodeTransactionXdr(fixtures.withdrawWithTransfer(), PASSPHRASE, { ...opts, labels: { [TOKEN_SAC]: "USDC" } });
    const flat = flattenAuth(d.operations[0].auth[0].root);
    expect(flat.map((f) => f.depth)).toEqual([0, 1]);
    const sub = flat[1].node.fn;
    expect(sub.kind === "contract" && sub.invocation.fn).toBe("transfer");
    expect(sub.kind === "contract" && sub.invocation.contractLabel).toBe("USDC");
    // The token SAC is not a Zenith contract → surfaced as a warning.
    expect(d.warnings.map((w) => w.code)).toContain("unknown_contract");
  });

  it("decodes address credentials and warns on foreign auth", () => {
    const d = decode(fixtures.foreignAddressAuth());
    const [entry] = d.operations[0].auth;
    expect(entry).toMatchObject({ credentials: "address", address: ATTACKER, nonce: "42", signatureExpirationLedger: 1_300_000 });
    expect(d.warnings.map((w) => w.code)).toContain("foreign_auth");
  });

  it("shows unknown contracts as raw data with a warning (i128 negative, maps)", () => {
    const d = decode(fixtures.unknownContract());
    const inv = d.operations[0].invocation!;
    expect(inv).toMatchObject({ contractId: EVIL_CONTRACT, contractKind: null, known: false, contractLabel: "Unknown contract" });
    expect(inv.args[0]).toMatchObject({ name: "arg0", scType: "i128", value: -5n, display: "-5" });
    expect(inv.args[1].scType).toBe("map");
    expect(d.warnings[0].code).toBe("unknown_contract");
  });

  it("renders i128 values beyond 2^53 exactly", () => {
    const d = decode(fixtures.tamperedSubInvocation());
    const sub = d.operations[0].auth[0].root.subInvocations[0].fn;
    if (sub.kind !== "contract") throw new Error("expected contract fn");
    expect(sub.invocation.args[2].value).toBe(170_141_183_460_469_231_731_687_303_715_884_105_727n);
    expect(sub.invocation.args[2].full).toBe("170141183460469231731687303715884105727");
  });

  it("flags ScVal types that differ from the spec", () => {
    const d = decode(fixtures.wrongArgType());
    const strike = d.operations[0].invocation!.args[2];
    expect(strike).toMatchObject({ scType: "i128", expectedType: "u128", typeMismatch: true });
    expect(d.warnings.map((w) => w.code)).toContain("type_mismatch");
  });

  it("warns on non-contract operations", () => {
    const d = decode(fixtures.tamperedExtraPayment());
    expect(d.operations[1]).toMatchObject({ type: "payment", invocation: null });
    expect(d.operations[1].rawXdr).not.toBe("");
    expect(d.warnings.map((w) => w.code)).toContain("non_contract_operation");
  });

  it("unwraps fee-bump envelopes", () => {
    const d = decode(feeBump(fixtures.open()));
    expect(d.feeBump).toBe(true);
    expect(d.operations[0].invocation?.fn).toBe("open_position");
  });

  it("throws on malformed XDR", () => {
    expect(() => decode("not-xdr")).toThrow();
  });
});

describe("intent verification against fixtures", () => {
  it("accepts faithful transactions", () => {
    expect(verifyIntent(decode(fixtures.open()), OPEN_INTENT, opts)).toEqual({ ok: true, mismatches: [] });
    expect(
      verifyIntent(decode(fixtures.withdrawWithTransfer()), WITHDRAW_INTENT, { ...opts, allowedSubContracts: [TOKEN_SAC] }).ok
    ).toBe(true);
  });

  const cases: Array<[string, () => string, typeof OPEN_INTENT | typeof WITHDRAW_INTENT, string[]]> = [
    ["swapped strike", fixtures.tamperedStrike, OPEN_INTENT, ["args.strike"]],
    ["flipped side", fixtures.tamperedSide, OPEN_INTENT, ["args.side"]],
    ["inflated size", fixtures.tamperedSize, OPEN_INTENT, ["args.contracts"]],
    ["swapped recipient", fixtures.tamperedRecipient, WITHDRAW_INTENT, ["source", "args.caller"]],
    ["look-alike contract", fixtures.tamperedContract, OPEN_INTENT, ["contract"]],
    ["auth for a different call", fixtures.tamperedAuthRoot, OPEN_INTENT, ["auth[0].root"]],
    ["hidden sub-invocation", fixtures.tamperedSubInvocation, WITHDRAW_INTENT, ["auth[0].sub[0]"]],
    ["appended payment", fixtures.tamperedExtraPayment, OPEN_INTENT, ["operations"]],
    ["foreign auth credentials", fixtures.foreignAddressAuth, OPEN_INTENT, ["auth[0].address"]],
    ["wrong arg type", fixtures.wrongArgType, OPEN_INTENT, ["args.strike", "auth"]],
  ];

  it.each(cases)("blocks %s", (_name, build, intent, fields) => {
    const result = verifyIntent(decode(build()), intent, opts);
    expect(result.ok).toBe(false);
    expect(result.mismatches.map((m) => m.field)).toEqual(expect.arrayContaining(fields));
  });
});

describe("reviewTransaction / assertions", () => {
  it("passes a faithful transaction without reporting", () => {
    const review = reviewTransaction(fixtures.open(), PASSPHRASE, OPEN_INTENT, opts);
    expect(review.verification.ok).toBe(true);
    expect(() => assertVerified(review)).not.toThrow();
    expect(captureError).not.toHaveBeenCalled();
  });

  it("reports a mismatch to monitoring and blocks", () => {
    const review = reviewTransaction(fixtures.tamperedStrike(), PASSPHRASE, OPEN_INTENT, opts);
    expect(review.verification.ok).toBe(false);
    expect(captureError).toHaveBeenCalledWith(
      expect.any(IntentMismatchError),
      expect.objectContaining({ context: "clear-signing", fingerprint: ["clear-signing", "intent-mismatch", "open_position"] })
    );
    expect(() => assertVerified(review)).toThrow(IntentMismatchError);
  });

  it("logs a warning message when verified with warnings", () => {
    reviewTransaction(fixtures.withdrawWithTransfer(), PASSPHRASE, WITHDRAW_INTENT, { ...opts, allowedSubContracts: [TOKEN_SAC] });
    expect(captureMessage).toHaveBeenCalledWith(expect.stringContaining("unknown_contract"), "warning");
  });

  it("treats undecodable XDR as a blocking mismatch", () => {
    expect(() => reviewTransaction("garbage", PASSPHRASE, OPEN_INTENT, opts)).toThrow(IntentMismatchError);
    expect(captureError).toHaveBeenCalled();
  });

  it("accepts the reviewed transaction once signed", () => {
    const xdrStr = fixtures.open();
    const review = reviewTransaction(xdrStr, PASSPHRASE, OPEN_INTENT, opts);
    expect(() => assertSignedMatchesReviewed(review, sign(xdrStr))).not.toThrow();
  });

  it("rejects a wallet that returns a different transaction", () => {
    const review = reviewTransaction(fixtures.open(), PASSPHRASE, OPEN_INTENT, opts);
    expect(() => assertSignedMatchesReviewed(review, sign(fixtures.tamperedStrike()))).toThrow(/different transaction/);
  });
});
