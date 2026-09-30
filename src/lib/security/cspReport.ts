/**
 * Normalises CSP violation reports from both browser formats (#117).
 * Kept out of the route file because Next.js only allows HTTP-method
 * exports there.
 */

export interface CspViolation {
  documentUri: string;
  blockedUri: string;
  directive: string;
  disposition: string;
  sourceFile?: string;
  line?: number;
  sample?: string;
}

type Raw = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

export function normalizeReports(body: unknown): CspViolation[] {
  // Reporting API: [{ type: "csp-violation", body: {...} }, ...]
  if (Array.isArray(body)) {
    return body
      .filter((r: Raw) => r?.type === "csp-violation" && r.body && typeof r.body === "object")
      .map((r: Raw) => {
        const b = r.body as Raw;
        return {
          documentUri: str(b.documentURL) ?? "",
          blockedUri: str(b.blockedURL) ?? "",
          directive: str(b.effectiveDirective) ?? "",
          disposition: str(b.disposition) ?? "",
          sourceFile: str(b.sourceFile),
          line: num(b.lineNumber),
          sample: str(b.sample),
        };
      });
  }
  // Legacy: { "csp-report": {...} }
  const legacy = (body as Raw)?.["csp-report"] as Raw | undefined;
  if (legacy && typeof legacy === "object") {
    return [{
      documentUri: str(legacy["document-uri"]) ?? "",
      blockedUri: str(legacy["blocked-uri"]) ?? "",
      directive: str(legacy["effective-directive"]) ?? str(legacy["violated-directive"]) ?? "",
      disposition: str(legacy.disposition) ?? "",
      sourceFile: str(legacy["source-file"]),
      line: num(legacy["line-number"]),
      sample: str(legacy["script-sample"]),
    }];
  }
  return [];
}
