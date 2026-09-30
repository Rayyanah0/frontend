#!/usr/bin/env node
// CI check for message catalogs (#116). Every locale in messages/ must have
// exactly the keys in messages/en.json, with no empty strings and the same
// ICU placeholders and rich-text tags. Exits 1 on any problem.
//
//   npm run i18n:check
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { compareCatalogs, isClean } = require("../src/lib/i18n/keys.cjs");

const dir = "messages";
const source = JSON.parse(readFileSync(join(dir, "en.json"), "utf8"));
let failed = false;

for (const file of readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "en.json").sort()) {
  const locale = file.replace(/\.json$/, "");
  const report = compareCatalogs(source, JSON.parse(readFileSync(join(dir, file), "utf8")), locale);
  if (isClean(report)) {
    console.log(`✓ ${locale}`);
    continue;
  }
  failed = true;
  console.error(`✗ ${locale}`);
  for (const k of report.missing) console.error(`    missing      ${k}`);
  for (const k of report.extra) console.error(`    extra        ${k}`);
  for (const k of report.empty) console.error(`    empty        ${k}`);
  for (const m of report.placeholderMismatch) console.error(`    placeholders ${m.key}: expected [${m.expected}] got [${m.actual}]`);
}

process.exit(failed ? 1 : 0);
