/**
 * Unit tests for the action builder: arg encoders, catalog lookups,
 * the schema-driven form generator, and human-readable summaries.
 */

import {
  GOVERNABLE_CONTRACTS,
  buildFormFields,
  dangerNote,
  defaultValuesFor,
  describeAction,
  describeParamError,
  encodeAction,
  encodeParam,
  findContract,
  findFunction,
  findParamSpec,
  formatParamValue,
  isActionValid,
  shortenAddress,
  type ActionParamSpec,
} from "../actions";
import type { ProposalAction } from "../actions";

const ACCOUNT_A = "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4";
const ACCOUNT_B = "GBQ37LN4NVDK6ZCQC4Y6UFVP52XOAISX5UWYHYWKWXONXLT4WQ5E64U5";
const CONTRACT_A = "CBLY5XSJLCYNHLV7WTULBLSVX2XXAHNZACQYGGKNXAKCICWITZBKXRWY";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const spec = (over: Partial<ActionParamSpec> = {}): ActionParamSpec => ({
  name: "value",
  label: "Value",
  type: "u32",
  ...over,
});

function action(over: Partial<ProposalAction> = {}): ProposalAction {
  return {
    id: "a1",
    contractKey: "market",
    functionName: "set_collateral_ratio",
    values: { ratio_bps: "12000" },
    ...over,
  };
}

function expectOk(result: ReturnType<typeof encodeParam>, expected: unknown) {
  expect(result.ok).toBe(true);
  // toEqual, not toBe — encoded values include BigInt and string arrays.
  if (result.ok) expect(result.value).toEqual(expected);
}

function expectErr(result: ReturnType<typeof encodeParam>, error: string) {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe(error);
}

// ---------------------------------------------------------------------------
// Integer encoders
// ---------------------------------------------------------------------------

describe("encodeParam — integers", () => {
  it("encodes u32 values as BigInt", () => {
    expectOk(encodeParam(spec({ type: "u32" }), "11000"), 11000n);
    expectOk(encodeParam(spec({ type: "u32" }), "0"), 0n);
  });

  it("accepts grouping separators for readability", () => {
    expectOk(encodeParam(spec({ type: "u128" }), "1_000_000"), 1000000n);
    expectOk(encodeParam(spec({ type: "u128" }), "10,000,000"), 10000000n);
  });

  it("trims whitespace", () => {
    expectOk(encodeParam(spec({ type: "u64" }), "  42  "), 42n);
  });

  it("requires a value for numeric fields rather than defaulting to zero", () => {
    // An empty governance field must never silently become 0 — that would
    // turn a typo into a valid-looking proposal.
    expectErr(encodeParam(spec({ type: "u32" }), ""), "required");
    expectErr(encodeParam(spec({ type: "i128" }), "   "), "required");
  });

  it("rejects non-numeric input", () => {
    expectErr(encodeParam(spec({ type: "u32" }), "abc"), "not_a_number");
    expectErr(encodeParam(spec({ type: "u32" }), "12.5"), "not_a_number");
    expectErr(encodeParam(spec({ type: "u32" }), "0x1f"), "not_a_number");
  });

  it("rejects negative values for unsigned types", () => {
    expectErr(encodeParam(spec({ type: "u32" }), "-1"), "not_a_number");
  });

  it("accepts negative values for i128", () => {
    expectOk(encodeParam(spec({ type: "i128" }), "-500"), -500n);
    expectOk(encodeParam(spec({ type: "i128" }), "-1_000"), -1000n);
  });

  it("rejects i128 below the signed minimum", () => {
    const tooSmall = (2n ** 127n).toString();
    expectErr(encodeParam(spec({ type: "i128" }), tooSmall), "out_of_range");
    expectOk(encodeParam(spec({ type: "i128" }), (-(2n ** 127n)).toString()), -(2n ** 127n));
  });

  it("enforces per-type upper bounds", () => {
    expectOk(encodeParam(spec({ type: "u32" }), (2n ** 32n - 1n).toString()), 2n ** 32n - 1n);
    expectErr(encodeParam(spec({ type: "u32" }), (2n ** 32n).toString()), "out_of_range");

    expectOk(encodeParam(spec({ type: "u64" }), (2n ** 64n - 1n).toString()), 2n ** 64n - 1n);
    expectErr(encodeParam(spec({ type: "u64" }), (2n ** 64n).toString()), "out_of_range");

    expectOk(encodeParam(spec({ type: "u128" }), (2n ** 128n - 1n).toString()), 2n ** 128n - 1n);
    expectErr(encodeParam(spec({ type: "u128" }), (2n ** 128n).toString()), "out_of_range");
  });

  it("preserves i128 magnitudes that a JS number could not represent", () => {
    const huge = "170141183460469231731687303715884105727"; // i128::MAX
    const result = encodeParam(spec({ type: "i128" }), huge);
    expectOk(result, 170141183460469231731687303715884105727n);
    // Confirm the same value would lose precision as a Number.
    expect(Number(huge).toString()).not.toBe(huge);
  });
});

// ---------------------------------------------------------------------------
// Non-integer encoders
// ---------------------------------------------------------------------------

describe("encodeParam — bool", () => {
  it("accepts true/false case-insensitively", () => {
    expectOk(encodeParam(spec({ type: "bool" }), "true"), true);
    expectOk(encodeParam(spec({ type: "bool" }), "TRUE"), true);
    expectOk(encodeParam(spec({ type: "bool" }), " false "), false);
  });

  it("rejects anything else", () => {
    expectErr(encodeParam(spec({ type: "bool" }), "yes"), "invalid_bool");
    expectErr(encodeParam(spec({ type: "bool" }), "1"), "invalid_bool");
    expectErr(encodeParam(spec({ type: "bool" }), ""), "required");
  });
});

describe("encodeParam — addresses", () => {
  it("accepts account and contract addresses for type 'address'", () => {
    expectOk(encodeParam(spec({ type: "address" }), ACCOUNT_A), ACCOUNT_A);
    expectOk(encodeParam(spec({ type: "address" }), CONTRACT_A), CONTRACT_A);
  });

  it("accepts only contract addresses for type 'contract'", () => {
    expectOk(encodeParam(spec({ type: "contract" }), CONTRACT_A), CONTRACT_A);
    expectErr(encodeParam(spec({ type: "contract" }), ACCOUNT_A), "invalid_contract");
  });

  it("rejects malformed addresses", () => {
    expectErr(encodeParam(spec({ type: "address" }), "GABC"), "invalid_address");
    expectErr(encodeParam(spec({ type: "address" }), ACCOUNT_A.slice(0, 55)), "invalid_address");
    expectErr(encodeParam(spec({ type: "address" }), ""), "required");
  });

  it("rejects an address with a broken checksum", () => {
    const mutated = ACCOUNT_A.slice(0, 10) + (ACCOUNT_A[10] === "A" ? "B" : "A") + ACCOUNT_A.slice(11);
    expectErr(encodeParam(spec({ type: "address" }), mutated), "invalid_address");
  });
});

describe("encodeParam — vec<address>", () => {
  it("accepts a whitespace or comma separated list", () => {
    expectOk(
      encodeParam(spec({ type: "vec<address>" }), `${ACCOUNT_A}, ${ACCOUNT_B}`),
      [ACCOUNT_A, ACCOUNT_B]
    );
    expectOk(
      encodeParam(spec({ type: "vec<address>" }), `${ACCOUNT_A}\n${ACCOUNT_B}`),
      [ACCOUNT_A, ACCOUNT_B]
    );
  });

  it("rejects an empty list", () => {
    expectErr(encodeParam(spec({ type: "vec<address>" }), "  "), "required");
  });

  it("rejects a list containing an invalid entry", () => {
    expectErr(encodeParam(spec({ type: "vec<address>" }), `${ACCOUNT_A},nope`), "invalid_address");
  });
});

describe("encodeParam — symbol and string", () => {
  it("accepts short symbols", () => {
    expectOk(encodeParam(spec({ type: "symbol" }), "XLM"), "XLM");
  });

  it("rejects symbols with spaces", () => {
    expectErr(encodeParam(spec({ type: "symbol" }), "X LM"), "invalid_symbol");
  });

  it("rejects oversized symbols and strings", () => {
    expectErr(encodeParam(spec({ type: "symbol" }), "A".repeat(33)), "too_long");
    expectErr(encodeParam(spec({ type: "string" }), "a".repeat(101)), "too_long");
  });
});

describe("encodeParam — optional and required", () => {
  it("marks empty optional fields as undefined", () => {
    const result = encodeParam(spec({ type: "u32", optional: true }), "");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBeUndefined();
  });

  it("marks empty required fields as an error", () => {
    expectErr(encodeParam(spec({ type: "u32" }), ""), "required");
  });
});

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

describe("governable contracts catalog", () => {
  it("exposes unique contract keys", () => {
    const keys = GOVERNABLE_CONTRACTS.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("exposes unique function names within each contract", () => {
    for (const contract of GOVERNABLE_CONTRACTS) {
      const names = contract.functions.map((f) => f.name);
      expect({ contract: contract.key, unique: new Set(names).size === names.length }).toEqual({
        contract: contract.key,
        unique: true,
      });
    }
  });

  it("only exposes params that declare a readMethod or are constant-ish", () => {
    // Every parameter must declare enough metadata for the simulation step.
    for (const contract of GOVERNABLE_CONTRACTS) {
      for (const fn of contract.functions) {
        expect(fn.params.length).toBeGreaterThan(0);
        for (const param of fn.params) {
          expect(typeof param.label).toBe("string");
          expect(param.label.length).toBeGreaterThan(0);
          expect(param.readMethod).toBeTruthy();
        }
      }
    }
  });

  it("includes a dangerous upgrade entry", () => {
    const deployer = findContract("deployer");
    const upgrade = deployer?.functions.find((f) => f.name === "upgrade_contract");
    expect(upgrade?.dangerous).toBe(true);
    expect(upgrade?.dangerNote).toMatch(/implementation|WASM|code/i);
  });

  it("looks contracts and functions up by key and name", () => {
    expect(findContract("market")?.name).toBe("ZenithMarket");
    expect(findFunction("market", "set_collateral_ratio")?.label).toBe("Put collateral ratio");
    expect(findFunction("market", "nope")).toBeUndefined();
    expect(findContract("nope")).toBeUndefined();
  });

  it("looks params up by name", () => {
    expect(findParamSpec("market", "set_collateral_ratio", "ratio_bps")?.type).toBe("u32");
    expect(findParamSpec("market", "set_collateral_ratio", "nope")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// encodeAction
// ---------------------------------------------------------------------------

describe("encodeAction", () => {
  it("encodes arguments in declaration order", () => {
    const encoded = encodeAction(action());
    expect(encoded?.args).toEqual([12000n]);
    expect(encoded?.errors).toEqual([]);
    expect(encoded?.contractName).toBe("ZenithMarket");
  });

  it("encodes multi-argument functions in order", () => {
    const encoded = encodeAction(
      action({
        contractKey: "oracle",
        functionName: "set_fallback_price",
        values: { asset: "XLM", price: "10000000" },
      })
    );
    expect(encoded?.args).toEqual(["XLM", 10000000n]);
  });

  it("collects per-field errors instead of throwing", () => {
    const encoded = encodeAction(action({ values: { ratio_bps: "abc" } }));
    expect(encoded?.errors).toEqual([{ paramName: "ratio_bps", error: "not_a_number" }]);
  });

  it("returns null for an unknown contract or function", () => {
    expect(encodeAction(action({ contractKey: "nope" }))).toBeNull();
    expect(encodeAction(action({ functionName: "nope" }))).toBeNull();
  });

  it("reports validity", () => {
    expect(isActionValid(action())).toBe(true);
    expect(isActionValid(action({ values: {} }))).toBe(false);
  });

  it("encodes boolean actions", () => {
    const encoded = encodeAction(
      action({ functionName: "set_paused", values: { paused: "true" } })
    );
    expect(encoded?.args).toEqual([true]);
  });
});

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

describe("formatParamValue", () => {
  it("renders basis points as a percentage", () => {
    const s = spec({ display: "bps", decimals: 0 });
    expect(formatParamValue(s, 11000n)).toBe("110%");
    expect(formatParamValue(s, 12000n)).toBe("120%");
  });

  it("renders basis points with decimals when asked", () => {
    const s = spec({ display: "bps", decimals: 2 });
    expect(formatParamValue(s, 50n)).toBe("0.50%");
  });

  it("renders stroops as XLM", () => {
    const s = spec({ display: "xlm", decimals: 7 });
    expect(formatParamValue(s, 10_000_000n)).toBe("1.0000000 XLM");
  });

  it("renders booleans", () => {
    expect(formatParamValue(spec({ display: "bool" }), true)).toBe("true");
    expect(formatParamValue(spec({ display: "bool" }), false)).toBe("false");
  });

  it("shortens addresses", () => {
    const s = spec({ display: "address" });
    expect(formatParamValue(s, ACCOUNT_A)).toBe("GAZW5D…W5D4");
  });

  it("renders an em dash for missing values", () => {
    expect(formatParamValue(spec(), undefined)).toBe("—");
    expect(formatParamValue(spec(), null)).toBe("—");
  });

  it("shortens long addresses and leaves short ones alone", () => {
    expect(shortenAddress(ACCOUNT_A)).toBe("GAZW5D…W5D4");
    expect(shortenAddress("C")).toBe("C");
    expect(shortenAddress("shortish")).toBe("shortish");
  });
});

// ---------------------------------------------------------------------------
// Summaries
// ---------------------------------------------------------------------------

describe("describeAction", () => {
  it("describes a single-parameter change", () => {
    expect(describeAction(action())).toBe("Put collateral ratio → Collateral ratio 120%");
  });

  it("describes multi-parameter changes", () => {
    const text = describeAction(
      action({
        contractKey: "oracle",
        functionName: "set_fallback_price",
        values: { asset: "XLM", price: "10000000" },
      })
    );
    expect(text).toContain("Asset XLM");
    expect(text).toContain("Price 10000000");
  });

  it("surfaces encoding failures in the summary instead of throwing", () => {
    expect(describeAction(action({ values: { ratio_bps: "abc" } }))).toContain("not a number");
  });

  it("falls back for unknown actions", () => {
    expect(describeAction(action({ functionName: "nope" }))).toBe("Unknown action");
  });
});

// ---------------------------------------------------------------------------
// Danger flags
// ---------------------------------------------------------------------------

describe("dangerNote", () => {
  it("flags contract upgrades", () => {
    const note = dangerNote(
      action({
        contractKey: "deployer",
        functionName: "upgrade_contract",
        values: { contract: CONTRACT_A, wasm_hash: "0xabc" },
      })
    );
    expect(note).toBeTruthy();
  });

  it("flags pauses", () => {
    expect(
      dangerNote(action({ functionName: "set_paused", values: { paused: "true" } }))
    ).toBeTruthy();
  });

  it("flags admin transfers", () => {
    expect(
      dangerNote(action({ contractKey: "timelock", functionName: "set_admin", values: { admin: ACCOUNT_A } }))
    ).toBeTruthy();
  });

  it("does not flag routine parameter changes", () => {
    expect(dangerNote(action())).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Form generator
// ---------------------------------------------------------------------------

describe("buildFormFields", () => {
  it("generates one field per declared parameter", () => {
    const fields = buildFormFields(action());
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({
      id: "action-ratio_bps",
      name: "ratio_bps",
      label: "Collateral ratio",
      type: "u32",
      value: "12000",
      inputMode: "numeric",
    });
  });

  it("seeds fields from the catalog's suggested values when blank", () => {
    const fields = buildFormFields({ ...action(), values: {} });
    expect(fields[0].value).toBe("11000");
  });

  it("defaults a bool param to false rather than leaving it empty", () => {
    // Regression: a <select> of true/false has no empty option, so an empty
    // value rendered as "false" while still encoding as a missing argument.
    const values = defaultValuesFor("market", "set_paused");
    expect(values).toEqual({ paused: "false" });

    const fields = buildFormFields(
      action({ functionName: "set_paused", values: defaultValuesFor("market", "set_paused") })
    );
    expect(fields[0].value).toBe("false");
    expect(encodeAction(action({ functionName: "set_paused", values }))?.errors).toEqual([]);
  });

  it("honours an explicit id prefix", () => {
    const fields = buildFormFields(action({ values: {} }), "act-7");
    expect(fields[0].id).toBe("act-7-ratio_bps");
  });

  it("gives booleans an option list instead of a free-text field", () => {
    const fields = buildFormFields(action({ functionName: "set_paused", values: {} }));
    expect(fields[0].options).toEqual([
      { value: "false", label: "false" },
      { value: "true", label: "true" },
    ]);
  });

  it("marks vector fields as multiline", () => {
    const fields = buildFormFields({
      contractKey: "oracle",
      functionName: "set_feeds",
      values: {},
    });
    expect(fields[0].type).toBe("vec<address>");
    expect(fields[0].multiline).toBe(true);
  });

  it("keeps scalar fields single-line", () => {
    const fields = buildFormFields(action());
    expect(fields[0].multiline).toBe(false);
  });

  it("returns an empty list for unknown functions", () => {
    expect(buildFormFields(action({ functionName: "nope" }))).toEqual([]);
  });

  it("exposes placeholders and help text", () => {
    const fields = buildFormFields(action());
    expect(fields[0].placeholder).toBe("11000");
    expect(fields[0].help).toMatch(/basis points/i);
  });

  it("covers every function in the catalog without producing invalid fields", () => {
    for (const contract of GOVERNABLE_CONTRACTS) {
      for (const fn of contract.functions) {
        const fields = buildFormFields({
          contractKey: contract.key,
          functionName: fn.name,
          values: {},
        });
        expect({ fn: fn.name, count: fields.length }).toEqual({ fn: fn.name, count: fn.params.length });
        for (const f of fields) {
          expect(f.label.length).toBeGreaterThan(0);
          expect(f.id).toBeTruthy();
        }
      }
    }
  });
});

describe("defaultValuesFor", () => {
  it("returns suggested values for known functions", () => {
    expect(defaultValuesFor("market", "set_collateral_ratio")).toEqual({ ratio_bps: "11000" });
  });

  it("omits params without a suggestion", () => {
    expect(defaultValuesFor("deployer", "upgrade_contract")).toEqual({});
  });

  it("returns an empty object for unknown functions", () => {
    expect(defaultValuesFor("market", "nope")).toEqual({});
  });
});

describe("describeParamError", () => {
  it("returns a sentence for every error code", () => {
    const codes = [
      "required", "not_a_number", "out_of_range", "not_integer", "invalid_address",
      "invalid_contract", "invalid_symbol", "too_long", "invalid_bool", "empty_list",
    ] as const;
    for (const code of codes) {
      expect(describeParamError(code).length).toBeGreaterThan(5);
    }
  });

  it("mentions G and C hints for invalid addresses", () => {
    expect(describeParamError("invalid_address")).toMatch(/G…/);
    expect(describeParamError("invalid_address")).toMatch(/C…/);
  });
});
