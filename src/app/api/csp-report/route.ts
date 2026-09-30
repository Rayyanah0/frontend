// CSP violation sink (#117). Browsers POST here via `report-uri` (the legacy
// application/csp-report format) and the Reporting API's `report-to`
// (application/reports+json). Violations are normalised, de-noised, and
// forwarded to monitoring. During the report-only rollout this is the
// signal used to decide when to flip CSP_MODE=enforce.
import { captureMessage } from "../../../lib/monitoring";
import { normalizeReports } from "../../../lib/security/cspReport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;
// Browser extensions inject scripts into every page. Their violations are
// noise, not attacks on us.
const EXTENSION_SCHEMES = /^(chrome|moz|safari|safari-web)-extension:/;

/** Strips query strings and fragments (may carry user data) before logging. */
function redact(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.origin}${u.pathname}`;
  } catch {
    return uri; // "inline", "eval", "self", ...
  }
}

export async function POST(req: Request): Promise<Response> {
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > MAX_BYTES) return new Response(null, { status: 413 });

  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > MAX_BYTES) return new Response(null, { status: 413 });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400 });
  }

  for (const v of normalizeReports(body)) {
    if (EXTENSION_SCHEMES.test(v.blockedUri) || EXTENSION_SCHEMES.test(v.sourceFile ?? "")) continue;
    const summary = `csp-violation ${v.disposition || "?"} ${v.directive} blocked=${redact(v.blockedUri)} doc=${redact(v.documentUri)}`;
    console.warn(`[csp] ${summary}${v.sourceFile ? ` src=${redact(v.sourceFile)}:${v.line ?? "?"}` : ""}`);
    void captureMessage(summary, v.disposition === "enforce" ? "error" : "warning");
  }
  return new Response(null, { status: 204 });
}
