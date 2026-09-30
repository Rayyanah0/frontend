#!/usr/bin/env node
// License compliance gate. Reads every package in package-lock.json, resolves
// its license (lockfile field, falling back to node_modules/<pkg>/package.json),
// evaluates SPDX expressions against security/license-policy.json, and fails
// on anything not allowed: copyleft licenses incompatible with how we ship,
// and unknown / missing licenses.
//
// Usage: node scripts/security/check-licenses.mjs [--production]
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "../..");
const policy = JSON.parse(readFileSync(resolve(ROOT, "security/license-policy.json"), "utf8"));
const lock = JSON.parse(readFileSync(resolve(ROOT, "package-lock.json"), "utf8"));
const productionOnly = process.argv.includes("--production");

const allowed = new Set(policy.allowed);
const now = Date.now();

/** Tiny SPDX expression evaluator: OR / AND / WITH / parentheses. */
export function satisfies(expr, isAllowed) {
  const tokens = expr.replace(/[()]/g, (m) => ` ${m} `).trim().split(/\s+/);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  function primary() {
    if (peek() === "(") {
      next();
      const v = orExpr();
      if (next() !== ")") throw new Error(`bad SPDX expression: ${expr}`);
      return v;
    }
    let id = next();
    if (!id) throw new Error(`bad SPDX expression: ${expr}`);
    if (peek() === "WITH") {
      next();
      id = `${id} WITH ${next()}`;
    }
    return isAllowed(id.replace(/\+$/, ""));
  }
  function andExpr() {
    let v = primary();
    while (peek() === "AND") {
      next();
      v = primary() && v;
    }
    return v;
  }
  function orExpr() {
    let v = andExpr();
    while (peek() === "OR") {
      next();
      v = andExpr() || v;
    }
    return v;
  }
  const result = orExpr();
  if (pos !== tokens.length) throw new Error(`bad SPDX expression: ${expr}`);
  return result;
}

function licenseOf(path, meta) {
  let lic = meta.license;
  if (!lic && existsSync(resolve(ROOT, path, "package.json"))) {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, path, "package.json"), "utf8"));
    lic = pkg.license ?? (Array.isArray(pkg.licenses) ? pkg.licenses.map((l) => l.type ?? l).join(" OR ") : undefined);
  }
  if (lic && typeof lic === "object") lic = lic.type;
  return typeof lic === "string" && lic.trim() ? lic.trim() : null;
}

const failures = [];
const waived = [];
let checked = 0;

for (const [path, meta] of Object.entries(lock.packages ?? {})) {
  if (!path || meta.link) continue; // root project / workspace links
  if (productionOnly && meta.dev) continue;
  const name = meta.name ?? path.slice(path.lastIndexOf("node_modules/") + "node_modules/".length);
  const license = licenseOf(path, meta);
  checked++;

  const ex = policy.exceptions.find((e) => e.package === name && (!e.version || e.version === meta.version));
  if (ex) {
    if (Date.parse(ex.expires) > now) {
      waived.push(`${name}@${meta.version} (${license ?? "unknown"}) — ${ex.reason}`);
      continue;
    }
    failures.push(`${name}@${meta.version}: license exception expired ${ex.expires}`);
    continue;
  }

  if (!license) {
    failures.push(`${name}@${meta.version}: UNKNOWN license`);
    continue;
  }
  let ok = false;
  try {
    ok = satisfies(license, (id) => allowed.has(id));
  } catch {
    ok = false;
  }
  if (!ok) failures.push(`${name}@${meta.version}: ${license} is not in the allowed list`);
}

for (const w of waived) console.log(`WAIVED  ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`::error::${f}`);
  console.error(`\n${failures.length} license violation(s) in ${checked} packages. See security/license-policy.json.`);
  process.exit(1);
}
console.log(`License check passed for ${checked} packages (${waived.length} reviewed exceptions).`);
