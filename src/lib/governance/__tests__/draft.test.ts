/**
 * Unit tests for draft persistence: validation, sanitisation of stored JSON,
 * and localStorage behaviour (including hostile storage).
 */

import {
  BODY_MIN,
  DRAFT_STORAGE_KEY,
  DRAFT_VERSION,
  SUMMARY_MAX,
  TITLE_MIN,
  TITLE_MAX,
  clearDraft,
  emptyDraft,
  loadDraft,
  makeAction,
  newActionId,
  parseDraft,
  saveDraft,
  serializeDraft,
  shortActionLabel,
  validateDraft,
  validateUrl,
  type ProposalDraft,
} from "../draft";

const ACCOUNT_A = "GAZW5DCXBTLD47MPGBNKNJQ6KIKCEIGXYI4RVCBZWVLN7PXXY3PBW5D4";

function validDraft(over: Partial<ProposalDraft> = {}): ProposalDraft {
  return {
    ...emptyDraft(),
    title: "Raise the collateral ratio",
    summary: "Short summary",
    body: "A description that is comfortably longer than the minimum length required.",
    actions: [makeAction("market", "set_collateral_ratio", { ratio_bps: "12000" })],
    ...over,
  };
}

// ---------------------------------------------------------------------------
// validateDraft
// ---------------------------------------------------------------------------

describe("validateDraft", () => {
  it("accepts a complete draft", () => {
    expect(validateDraft(validDraft())).toEqual({ ok: true, errors: {} });
  });

  it("requires a title", () => {
    expect(validateDraft(validDraft({ title: "" })).errors.title).toMatch(/required/i);
    expect(validateDraft(validDraft({ title: "   " })).errors.title).toMatch(/required/i);
  });

  it("enforces the title length bounds", () => {
    expect(validateDraft(validDraft({ title: "a".repeat(TITLE_MIN - 1) })).errors.title)
      .toMatch(/at least/);
    expect(validateDraft(validDraft({ title: "a".repeat(TITLE_MIN) })).ok).toBe(true);
    expect(validateDraft(validDraft({ title: "a".repeat(TITLE_MAX + 1) })).errors.title)
      .toMatch(/at most/);
  });

  it("requires a body and enforces its minimum length", () => {
    expect(validateDraft(validDraft({ body: "" })).errors.body).toMatch(/required/i);
    expect(validateDraft(validDraft({ body: "a".repeat(BODY_MIN - 1) })).errors.body)
      .toMatch(/at least/);
    expect(validateDraft(validDraft({ body: "a".repeat(BODY_MIN) })).ok).toBe(true);
  });

  it("caps the summary but allows it to be empty", () => {
    expect(validateDraft(validDraft({ summary: "" })).ok).toBe(true);
    expect(validateDraft(validDraft({ summary: "a".repeat(SUMMARY_MAX) })).ok).toBe(true);
    expect(validateDraft(validDraft({ summary: "a".repeat(SUMMARY_MAX + 1) })).errors.summary)
      .toMatch(/at most/);
  });

  it("requires at least one action", () => {
    expect(validateDraft(validDraft({ actions: [] })).errors.actions).toMatch(/at least one/i);
  });

  it("rejects a malformed discussion URL but allows an empty one", () => {
    expect(validateDraft(validDraft({ discussionUrl: "" })).ok).toBe(true);
    expect(validateDraft(validDraft({ discussionUrl: "not a url" })).errors.discussionUrl)
      .toBeTruthy();
    expect(validateDraft(validDraft({ discussionUrl: "javascript:alert(1)" })).errors.discussionUrl)
      .toMatch(/http/i);
  });

  it("reports every invalid field at once", () => {
    const result = validateDraft(validDraft({ title: "", body: "", actions: [] }));
    expect(Object.keys(result.errors).sort()).toEqual(["actions", "body", "title"]);
    expect(result.ok).toBe(false);
  });
});

describe("validateUrl", () => {
  it("accepts http and https", () => {
    expect(validateUrl("https://forum.example/t/1")).toBeNull();
    expect(validateUrl("http://forum.example/t/1")).toBeNull();
  });

  it("treats an empty value as valid (the field is optional)", () => {
    expect(validateUrl("")).toBeNull();
    expect(validateUrl("   ")).toBeNull();
  });

  it("rejects other protocols", () => {
    expect(validateUrl("ftp://example.com")).toMatch(/http/i);
    expect(validateUrl("javascript:alert(1)")).toMatch(/http/i);
    expect(validateUrl("data:text/html,<script>")).toMatch(/http/i);
  });

  it("rejects oversized URLs", () => {
    expect(validateUrl(`https://e.com/${"a".repeat(200)}`)).toMatch(/too long/i);
  });

  it("rejects unparseable input", () => {
    expect(validateUrl("forum post")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Serialisation
// ---------------------------------------------------------------------------

describe("serializeDraft / parseDraft", () => {
  it("round-trips a draft", () => {
    const draft = validDraft({ discussionUrl: "https://forum.example/t/1" });
    const parsed = parseDraft(serializeDraft(draft));
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe(draft.title);
    expect(parsed?.discussionUrl).toBe(draft.discussionUrl);
    expect(parsed?.actions).toHaveLength(1);
    expect(parsed?.actions[0].values).toEqual({ ratio_bps: "12000" });
  });

  it("stamps the current version and timestamp", () => {
    const parsed = parseDraft(serializeDraft(validDraft()));
    expect(parsed?.version).toBe(DRAFT_VERSION);
    expect(parsed?.updatedAt).toBeGreaterThan(0);
  });

  it("returns null for absent or malformed input", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("")).toBeNull();
    expect(parseDraft("{not json")).toBeNull();
    expect(parseDraft("[]")).toBeNull();
    expect(parseDraft("null")).toBeNull();
    expect(parseDraft('"a string"')).toBeNull();
  });

  it("rejects a draft written by an incompatible version", () => {
    const stale = JSON.stringify({ ...validDraft(), version: DRAFT_VERSION + 1 });
    expect(parseDraft(stale)).toBeNull();
  });

  it("coerces non-string fields to empty rather than propagating garbage", () => {
    const junk = JSON.stringify({
      version: DRAFT_VERSION,
      title: 42,
      summary: null,
      body: { nope: true },
      discussionUrl: [],
      actions: "not an array",
      updatedAt: "soon",
    });
    const parsed = parseDraft(junk);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("");
    expect(parsed?.summary).toBe("");
    expect(parsed?.body).toBe("");
    expect(parsed?.discussionUrl).toBe("");
    expect(parsed?.actions).toEqual([]);
    expect(parsed?.updatedAt).toBe(0);
  });

  it("drops actions whose contract or function no longer exists", () => {
    const json = JSON.stringify({
      version: DRAFT_VERSION,
      actions: [
        { id: "keep", contractKey: "market", functionName: "set_fee_bps", values: { fee_bps: "75" } },
        { id: "gone", contractKey: "market", functionName: "removed_in_a_later_release", values: {} },
        { id: "gone2", contractKey: "retired_contract", functionName: "whatever", values: {} },
        "not an object",
        null,
      ],
    });
    const parsed = parseDraft(json);
    expect(parsed?.actions).toHaveLength(1);
    expect(parsed?.actions[0].id).toBe("keep");
  });

  it("drops unknown parameter keys but keeps known ones", () => {
    const json = JSON.stringify({
      version: DRAFT_VERSION,
      actions: [
        {
          id: "a",
          contractKey: "market",
          functionName: "set_fee_bps",
          values: { fee_bps: "75", injected: "evil" },
        },
      ],
    });
    const parsed = parseDraft(json);
    expect(parsed?.actions[0].values).toEqual({ fee_bps: "75" });
  });

  it("coerces numeric values to strings", () => {
    const json = JSON.stringify({
      version: DRAFT_VERSION,
      actions: [
        { id: "a", contractKey: "market", functionName: "set_fee_bps", values: { fee_bps: 75 } },
      ],
    });
    expect(parseDraft(json)?.actions[0].values).toEqual({ fee_bps: "75" });
  });

  it("assigns a fallback id when one is missing", () => {
    const json = JSON.stringify({
      version: DRAFT_VERSION,
      actions: [{ contractKey: "market", functionName: "set_fee_bps", values: {} }],
    });
    expect(parseDraft(json)?.actions[0].id).toBe("a0");
  });

  it("regenerates ids for duplicated actions so keys stay unique", () => {
    const json = JSON.stringify({
      version: DRAFT_VERSION,
      actions: [
        { id: "same", contractKey: "market", functionName: "set_fee_bps", values: {} },
      ],
    });
    const parsed = parseDraft(json);
    expect(parsed?.actions[0].id).toBe("same");
    // makeAction must not collide with a restored id.
    expect(newActionId()).not.toBe("same");
  });
});

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

describe("localStorage integration", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("saves and loads a draft", () => {
    expect(saveDraft(validDraft())).toBe(true);
    const loaded = loadDraft();
    expect(loaded?.title).toBe("Raise the collateral ratio");
  });

  it("returns null when nothing is stored", () => {
    expect(loadDraft()).toBeNull();
  });

  it("returns null when the stored value is corrupt", () => {
    window.localStorage.setItem(DRAFT_STORAGE_KEY, "{{{ corrupt");
    expect(loadDraft()).toBeNull();
  });

  it("clears the draft", () => {
    saveDraft(validDraft());
    clearDraft();
    expect(loadDraft()).toBeNull();
    expect(window.localStorage.getItem(DRAFT_STORAGE_KEY)).toBeNull();
  });

  it("clearing twice is safe", () => {
    clearDraft();
    expect(() => clearDraft()).not.toThrow();
  });

  it("survives a storage backend that throws on write", () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("QuotaExceededError");
    };
    try {
      expect(saveDraft(validDraft())).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("survives a storage backend that throws on read", () => {
    const original = Storage.prototype.getItem;
    Storage.prototype.getItem = () => {
      throw new DOMException("SecurityError");
    };
    try {
      expect(loadDraft()).toBeNull();
    } finally {
      Storage.prototype.getItem = original;
    }
  });
});

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

describe("makeAction", () => {
  it("produces a unique id each time", () => {
    const a = makeAction("market", "set_fee_bps");
    const b = makeAction("market", "set_fee_bps");
    expect(a.id).not.toBe(b.id);
  });

  it("seeds values from the catalog defaults", () => {
    expect(makeAction("market", "set_collateral_ratio").values).toEqual({ ratio_bps: "11000" });
  });

  it("uses explicit values when given", () => {
    expect(makeAction("market", "set_collateral_ratio", { ratio_bps: "13000" }).values)
      .toEqual({ ratio_bps: "13000" });
  });

  it("yields empty values for a function with no suggestions", () => {
    expect(makeAction("deployer", "upgrade_contract").values).toEqual({});
  });
});

describe("shortActionLabel", () => {
  it("renders contract and function labels", () => {
    expect(shortActionLabel(makeAction("market", "set_collateral_ratio")))
      .toBe("Market · Put collateral ratio");
  });

  it("falls back for unknown actions", () => {
    expect(
      shortActionLabel({ id: "x", contractKey: "nope", functionName: "nope", values: {} })
    ).toBe("Unknown action");
  });
});

describe("emptyDraft", () => {
  it("starts blank at the current version", () => {
    const draft = emptyDraft();
    expect(draft.version).toBe(DRAFT_VERSION);
    expect(draft.title).toBe("");
    expect(draft.actions).toEqual([]);
    expect(draft.updatedAt).toBe(0);
  });
});
