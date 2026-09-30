#!/usr/bin/env node
// Dependency audit gate. Runs `npm audit --json` and fails on any HIGH or
// CRITICAL advisory that isn't covered by an unexpired entry in
// security/audit-exceptions.json.
//
// Usage: node scripts/security/audit-gate.mjs [--audit-json <file>]
//   --audit-json  read a saved `npm audit --json` report instead of running npm
//                 (used by CI to keep the raw report as an artifact).
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..");
const EXCEPTIONS_FILE = resolve(ROOT, "security/audit-exceptions.json");
const BLOCKING = new Set(["high", "critical"]);

function loadReport() {
  const i = process.argv.indexOf("--audit-json");
  if (i !== -1) return JSON.parse(readFileSync(process.argv[i + 1], "utf8"));
  try {
    return JSON.parse(execFileSync("npm", ["audit", "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
  } catch (err) {
    // npm audit exits non-zero when it finds anything; the JSON is still on stdout.
    if (err.stdout) return JSON.parse(err.stdout);
    throw err;
  }
}

function loadExceptions() {
  if (!existsSync(EXCEPTIONS_FILE)) return [];
  const { exceptions = [] } = JSON.parse(readFileSync(EXCEPTIONS_FILE, "utf8"));
  const problems = [];
  for (const e of exceptions) {
    for (const field of ["id", "package", "reason", "expires", "approvedBy"]) {
      if (!e[field]) problems.push(`exception ${JSON.stringify(e)} is missing "${field}"`);
    }
    if (e.expires && Number.isNaN(Date.parse(e.expires))) problems.push(`exception ${e.id}: invalid expires date`);
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(2);
  }
  return exceptions;
}

/** Flatten npm audit v2 JSON into one row per (package, advisory). */
export function collectAdvisories(report) {
  const rows = [];
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via === "string") continue; // transitive pointer; the source package has its own row
      const id = via.url?.match(/GHSA-[\w-]+/)?.[0] ?? `npm-${via.source}`;
      rows.push({ pkg, id, severity: via.severity, title: via.title, url: via.url, range: via.range });
    }
  }
  return rows;
}

const report = loadReport();
const exceptions = loadExceptions();
const now = Date.now();

const blocking = [];
const waived = [];
for (const row of collectAdvisories(report)) {
  if (!BLOCKING.has(row.severity)) continue;
  const ex = exceptions.find((e) => e.id === row.id && (e.package === row.pkg || e.package === "*"));
  if (ex && Date.parse(ex.expires) > now) waived.push({ ...row, ex });
  else blocking.push({ ...row, expired: ex ? ex.expires : null });
}

const expiredUnused = exceptions.filter((e) => Date.parse(e.expires) <= now);
for (const e of expiredUnused) console.warn(`::warning::audit exception ${e.id} (${e.package}) expired on ${e.expires} — remove or renew it`);

for (const w of waived) {
  console.log(`WAIVED  ${w.severity.padEnd(8)} ${w.pkg} ${w.id} — ${w.ex.reason} (until ${w.ex.expires})`);
}
if (blocking.length) {
  for (const b of blocking) {
    console.error(
      `::error::${b.severity.toUpperCase()} ${b.pkg} ${b.id}: ${b.title} ${b.url ?? ""}${b.expired ? ` (exception expired ${b.expired})` : ""}`,
    );
  }
  console.error(`\n${blocking.length} blocking advisor${blocking.length === 1 ? "y" : "ies"}. Fix, upgrade, or add a reviewed entry to security/audit-exceptions.json.`);
  process.exit(1);
}
const meta = report.metadata?.vulnerabilities ?? {};
console.log(`Audit gate passed. Totals: ${JSON.stringify(meta)}`);
