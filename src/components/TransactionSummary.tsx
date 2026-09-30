"use client";

// Human-readable view of a decoded, assembled Soroban transaction (#119).
// Rendered inside ConfirmDialog before the wallet prompt.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { DecodedArg, DecodedAuthNode, DecodedInvocation } from "../lib/soroban/decode";
import type { ReviewedTransaction } from "../lib/soroban/tx";
import { formatBaseUnits, shortenAddress } from "../lib/soroban/units";

const label: React.CSSProperties = { fontSize: 10, color: "var(--text-lo)", textTransform: "uppercase", letterSpacing: "0.06em" };
const mono: React.CSSProperties = { fontFamily: "var(--font-jetbrains-mono), monospace", fontSize: 11 };

function CopyButton({ value }: { value: string }) {
  const t = useTranslations("common");
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={t("copyValue", { value })}
      title={t("copyFullValue")}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
      style={{ background: "none", border: "1px solid var(--border-default)", color: "var(--text-mid)", fontSize: 10, padding: "0 5px", cursor: "pointer" }}
    >
      {copied ? t("copied") : t("copy")}
    </button>
  );
}

function ArgRow({ arg }: { arg: DecodedArg }) {
  const copyable = arg.scType === "address" || arg.full.length > 24;
  return (
    <tr>
      <td style={{ ...label, padding: "3px 8px 3px 0", verticalAlign: "top" }}>{arg.label}</td>
      <td style={{ ...mono, padding: "3px 0", color: arg.typeMismatch ? "var(--put)" : "var(--text-hi)", wordBreak: "break-all" }}>
        <span title={arg.full}>{arg.display}</span>{" "}
        <span style={{ color: "var(--text-lo)" }}>({arg.scType}{arg.typeMismatch ? ` ≠ ${arg.expectedType}` : ""})</span>{" "}
        {copyable && <CopyButton value={arg.full} />}
      </td>
    </tr>
  );
}

function Invocation({ invocation }: { invocation: DecodedInvocation }) {
  const t = useTranslations("clearSign");
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--text-hi)", fontWeight: 600 }}>
        {invocation.summary ?? invocation.fn}
        <span style={{ ...mono, color: "var(--text-lo)", fontWeight: 400 }}>
          {" "}· {invocation.contractLabel} ({shortenAddress(invocation.contractId)}) <CopyButton value={invocation.contractId} />
        </span>
      </div>
      {!invocation.known && (
        <div role="alert" style={{ fontSize: 11, color: "var(--atm)", margin: "4px 0" }}>
          {invocation.contractKind ? t("unknownFunction") : t("unknownContract")}
        </div>
      )}
      <table style={{ borderCollapse: "collapse", marginTop: 4, width: "100%" }}>
        <tbody>{invocation.args.map((arg, i) => <ArgRow key={i} arg={arg} />)}</tbody>
      </table>
    </div>
  );
}

function AuthTree({ node, depth = 0 }: { node: DecodedAuthNode; depth?: number }) {
  return (
    <li style={{ marginLeft: depth * 12, listStyle: "none" }}>
      {node.fn.kind === "contract" ? (
        <span style={mono}>
          {depth > 0 && "↳ "}
          {node.fn.invocation.contractLabel}.{node.fn.invocation.fn}(
          {node.fn.invocation.args.map((a) => a.display).join(", ")})
        </span>
      ) : (
        <span style={mono}>{node.fn.description}</span>
      )}
      {node.subInvocations.length > 0 && (
        <ul style={{ padding: 0, margin: 0 }}>
          {node.subInvocations.map((sub, i) => <AuthTree key={i} node={sub} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

export function TransactionSummary({ review }: { review: ReviewedTransaction }) {
  const t = useTranslations("clearSign");
  const { decoded, verification } = review;
  const [showRaw, setShowRaw] = useState(false);

  return (
    <section aria-label={t("detailsLabel")} style={{ display: "flex", flexDirection: "column", gap: 10, fontSize: 12 }}>
      {!verification.ok && (
        <div role="alert" style={{ border: "1px solid var(--put)", padding: 8, color: "var(--put)" }}>
          <strong>{t("mismatchTitle")}</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: 16 }}>
            {verification.mismatches.map((m, i) => (
              <li key={i} style={mono}>
                {t("mismatchItem", { field: m.field, expected: m.expected, actual: m.actual })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {verification.ok && (
        <div role="status" style={{ fontSize: 11, color: "var(--call)" }}>
          {t("verified")}
        </div>
      )}

      {decoded.operations.map((op) => (
        <div key={op.index} style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8 }}>
          {op.invocation ? <Invocation invocation={op.invocation} /> : (
            <div style={{ color: "var(--put)" }}>{t("nonContractOperation", { type: op.type })}</div>
          )}
          <div style={{ ...label, marginTop: 8 }}>{t("authorizing")}</div>
          {op.auth.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-lo)" }}>{t("noAuthorizations")}</div>
          ) : (
            <ul style={{ padding: 0, margin: "4px 0 0" }}>
              {op.auth.map((entry, i) => (
                <li key={i} style={{ listStyle: "none", marginBottom: 4 }}>
                  <div style={{ fontSize: 11, color: "var(--text-mid)" }}>
                    {entry.credentials === "source_account"
                      ? t("sourceAccountAuth")
                      : entry.signatureExpirationLedger !== null
                        ? t("addressAuthExpiry", { address: shortenAddress(entry.address ?? ""), ledger: entry.signatureExpirationLedger })
                        : t("addressAuth", { address: shortenAddress(entry.address ?? "") })}
                  </div>
                  <ul style={{ padding: 0, margin: 0 }}><AuthTree node={entry.root} /></ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      <div style={{ borderTop: "1px solid var(--border-default)", paddingTop: 8, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px" }}>
        <span style={label}>{t("maxFee")}</span>
        <span style={mono}>{decoded.fees.totalXlm} XLM</span>
        <span style={label}>{t("resourceFee")}</span>
        <span style={mono}>{formatBaseUnits(decoded.fees.resourceStroops, 7)} XLM</span>
        <span style={label}>{t("source")}</span>
        <span style={mono}>{shortenAddress(decoded.source)} <CopyButton value={decoded.source} /></span>
        <span style={label}>{t("txHash")}</span>
        <span style={mono}>{shortenAddress(decoded.hash, 8, 8)}</span>
      </div>

      {decoded.warnings.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 16, color: "var(--atm)", fontSize: 11 }}>
          {decoded.warnings.map((w, i) => <li key={i}>{w.message}</li>)}
        </ul>
      )}

      <button type="button" onClick={() => setShowRaw((v) => !v)} style={{ alignSelf: "flex-start", background: "none", border: "none", color: "var(--text-lo)", fontSize: 11, cursor: "pointer", padding: 0 }}>
        {showRaw ? t("hideRaw") : t("showRaw")}
      </button>
      {showRaw && (
        <textarea readOnly value={review.xdr} rows={4} style={{ ...mono, width: "100%", background: "var(--bg)", color: "var(--text-mid)", border: "1px solid var(--border-default)" }} />
      )}
    </section>
  );
}
