"use client";

import { hasMixedScripts, inspectAddress, safeText, type SafeTextOptions } from "../lib/sanitize";

/** Render an untrusted backend string as plain text (control/bidi stripped, length capped). */
export function SafeText({ children, maxLength, singleLine, ...rest }: { children: unknown } & SafeTextOptions & React.HTMLAttributes<HTMLSpanElement>) {
  const full = safeText(children, { maxLength: Number.MAX_SAFE_INTEGER, singleLine });
  const shown = safeText(children, { maxLength, singleLine });
  return (
    <span {...rest} title={shown !== full ? full.slice(0, 2000) : rest.title}>
      {shown}
    </span>
  );
}

/**
 * Render a Stellar address / contract id. Anything outside the strkey
 * alphabet (homoglyphs, zero-width or bidi characters) is shown explicitly as
 * ⟪…:U+XXXX⟫ with a warning, so a spoofed address can't pass as genuine.
 */
export function SafeAddress({ address, truncate = false, style }: { address: string; truncate?: boolean; style?: React.CSSProperties }) {
  const { text, suspicious } = inspectAddress(address);
  const display = !suspicious && truncate && text.length > 12 ? `${text.slice(0, 6)}…${text.slice(-6)}` : text;
  return (
    <span
      className="num"
      title={suspicious ? "Warning: this address contains unexpected characters" : text}
      data-suspicious={suspicious || undefined}
      style={{ unicodeBidi: "isolate", ...(suspicious ? { color: "var(--put)", textDecoration: "underline wavy" } : {}), ...style }}
    >
      {suspicious && "⚠ "}
      {display}
    </span>
  );
}

/** Display names / asset codes: text-safe, isolated from surrounding bidi, flagged when scripts are mixed. */
export function SafeName({ name, maxLength = 64 }: { name: unknown; maxLength?: number }) {
  const text = safeText(name, { maxLength });
  const mixed = hasMixedScripts(text);
  return (
    <bdi title={mixed ? "Warning: this name mixes alphabets (possible look-alike characters)" : undefined} data-mixed-script={mixed || undefined}>
      {mixed && "⚠ "}
      {text}
    </bdi>
  );
}
