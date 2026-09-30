/**
 * Message-catalog completeness checks (#116). Plain CommonJS so the CI
 * script (scripts/i18n-check.mjs) and Jest can both load it without a
 * TypeScript step, following the same pattern as src/env-schema.cjs.
 *
 * @typedef {{ [key: string]: string | Catalog }} Catalog
 * @typedef {{ locale: string, missing: string[], extra: string[], empty: string[],
 *   placeholderMismatch: Array<{ key: string, expected: string[], actual: string[] }> }} LocaleReport
 */

/** Flattens nested messages to dotted keys: { a: { b: "x" } } → { "a.b": "x" }. */
function flatten(catalog, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(catalog)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") out[path] = value;
    else Object.assign(out, flatten(value, path));
  }
  return out;
}

/** Top-level ICU argument names ({name}, {n, plural, …}) and rich-text tags (<link>). */
function placeholders(message) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const c = message[i];
    if (c === "{") {
      if (depth === 0) {
        const m = /^\{\s*([A-Za-z_]\w*)/.exec(message.slice(i));
        if (m) names.add(m[1]);
      }
      depth++;
    } else if (c === "}") depth = Math.max(0, depth - 1);
  }
  for (const m of message.matchAll(/<([A-Za-z]\w*)>/g)) names.add(`<${m[1]}>`);
  return [...names].sort();
}

/** @returns {LocaleReport} */
function compareCatalogs(source, target, locale) {
  const src = flatten(source);
  const tgt = flatten(target);
  const report = { locale, missing: [], extra: [], empty: [], placeholderMismatch: [] };
  for (const key of Object.keys(src)) {
    if (!(key in tgt)) {
      report.missing.push(key);
      continue;
    }
    if (!tgt[key].trim()) report.empty.push(key);
    const expected = placeholders(src[key]);
    const actual = placeholders(tgt[key]);
    if (expected.join() !== actual.join()) report.placeholderMismatch.push({ key, expected, actual });
  }
  for (const key of Object.keys(tgt)) if (!(key in src)) report.extra.push(key);
  return report;
}

function isClean(r) {
  return !r.missing.length && !r.extra.length && !r.empty.length && !r.placeholderMismatch.length;
}

module.exports = { compareCatalogs, flatten, isClean, placeholders };
