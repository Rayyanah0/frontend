#!/usr/bin/env node
/**
 * check-external-scripts.mjs
 * CI guard: fail if any built HTML page loads an external script or stylesheet
 * without a Subresource Integrity (integrity=) attribute.
 *
 * Usage:
 *   node scripts/check-external-scripts.mjs [--html-dir .next]
 *
 * Exit codes:
 *   0 — all external resources are either same-origin or SRI-pinned
 *   1 — one or more unpinned external resources found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "html-dir": { type: "string", default: ".next" },
    "allow-origins": { type: "string", default: "" },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(`
check-external-scripts.mjs

Usage: node scripts/check-external-scripts.mjs [options]

Options:
  --html-dir <dir>        Directory to scan (default: .next)
  --allow-origins <list>  Comma-separated origins to allow without SRI
  -h, --help              Show this help
  `);
  process.exit(0);
}

const HTML_DIR = values["html-dir"];
const ALLOWED_ORIGINS = (values["allow-origins"] || "").split(",").filter(Boolean);

// Regex to match script/link tags with src/href pointing to external origins
const EXTERNAL_SCRIPT_RE = /<script[^>]+src=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const EXTERNAL_LINK_RE = /<link[^>]+href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
const INTEGRITY_RE = /\bintegrity=["'][^"']+["']/i;

/** Recursively find all .html files under dir */
function findHtml(dir) {
  const results = [];
  try {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      const stat = statSync(full);
      if (stat.isDirectory()) results.push(...findHtml(full));
      else if (extname(name) === ".html") results.push(full);
    }
  } catch {
    // Directory may not exist during dry runs
  }
  return results;
}

function originOf(url) {
  try { return new URL(url).origin; } catch { return url; }
}

function isAllowed(url) {
  const origin = originOf(url);
  return ALLOWED_ORIGINS.some(o => origin === o || origin.endsWith(o));
}

let violations = 0;
const files = findHtml(HTML_DIR);

if (files.length === 0) {
  console.warn(`[sri-check] No HTML files found under '${HTML_DIR}'. Run 'next build' first.`);
  // Exit 0 — don't fail on a missing build (CI may run this after build)
  process.exit(0);
}

console.log(`[sri-check] Scanning ${files.length} HTML file(s) in '${HTML_DIR}'…\n`);

for (const file of files) {
  const html = readFileSync(file, "utf8");
  const relative = file.replace(process.cwd() + "/", "");

  const checkMatches = (regex, tagType) => {
    let match;
    while ((match = regex.exec(html)) !== null) {
      const fullTag = match[0];
      const url = match[1];
      if (isAllowed(url)) continue;
      if (!INTEGRITY_RE.test(fullTag)) {
        console.error(`  ✗ [${tagType}] Missing integrity attribute`);
        console.error(`    File: ${relative}`);
        console.error(`    URL:  ${url}`);
        console.error(`    Tag:  ${fullTag.slice(0, 120)}…\n`);
        violations++;
      }
    }
  };

  checkMatches(EXTERNAL_SCRIPT_RE, "script");
  checkMatches(EXTERNAL_LINK_RE, "link");
}

if (violations === 0) {
  console.log(`[sri-check] ✓ No unpinned external resources found.`);
  process.exit(0);
} else {
  console.error(`[sri-check] ✗ ${violations} unpinned external resource(s) found. Add integrity= and crossorigin= attributes, or self-host the resource.`);
  process.exit(1);
}
