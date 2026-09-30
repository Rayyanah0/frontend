import { compareCatalogs, flatten, isClean, placeholders } from "../keys.cjs";
import en from "../../../../messages/en.json";
import es from "../../../../messages/es.json";
import pt from "../../../../messages/pt.json";

describe("flatten", () => {
  it("produces dotted keys", () => {
    expect(flatten({ a: { b: "x", c: { d: "y" } }, e: "z" })).toEqual({ "a.b": "x", "a.c.d": "y", e: "z" });
  });
});

describe("placeholders", () => {
  it("finds top-level ICU args and rich tags, not nested plural text", () => {
    expect(placeholders("Hi {name}")).toEqual(["name"]);
    expect(placeholders("{minutes, plural, one {# min} other {# min}}")).toEqual(["minutes"]);
    expect(placeholders("Star on the <link>chain</link>")).toEqual(["<link>"]);
    expect(placeholders("plain")).toEqual([]);
  });
});

describe("compareCatalogs", () => {
  const source = { a: "A {x}", b: { c: "C" } };

  it("is clean for a complete translation", () => {
    expect(isClean(compareCatalogs(source, { a: "Á {x}", b: { c: "Ç" } }, "xx"))).toBe(true);
  });

  it("reports missing, extra, empty and placeholder drift", () => {
    const r = compareCatalogs(source, { a: "Á {y}", b: { c: " " }, z: "extra" }, "xx");
    expect(r.missing).toEqual([]);
    expect(r.extra).toEqual(["z"]);
    expect(r.empty).toEqual(["b.c"]);
    expect(r.placeholderMismatch).toEqual([{ key: "a", expected: ["x"], actual: ["y"] }]);
    expect(isClean(r)).toBe(false);
    expect(compareCatalogs(source, { a: "Á {x}" }, "xx").missing).toEqual(["b.c"]);
  });
});

describe("shipped catalogs", () => {
  it.each([["es", es], ["pt", pt]])("%s is complete against en", (locale, catalog) => {
    expect(compareCatalogs(en, catalog, locale)).toEqual({ locale, missing: [], extra: [], empty: [], placeholderMismatch: [] });
  });
});
