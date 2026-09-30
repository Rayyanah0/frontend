// Central sanitization layer for untrusted content: proposal / strategy /
// delegate markdown, backend error strings, token & asset metadata.
//
// Rules of use:
//   - Markdown          → <SafeMarkdown> (src/components/SafeMarkdown.tsx), which uses SANITIZE_SCHEMA.
//   - Plain strings     → safeText() or <SafeText>.
//   - Addresses / names → revealInvisible() or <SafeAddress> (bidi + homoglyph aware).
//   - URLs in href/src  → safeUrl().
// There is exactly ONE sanitize schema. Feature code must not build its own;
// changes bump SANITIZE_SCHEMA_VERSION and need security review.
// Type-only import: this module is also used by the API client, which must
// not pull the markdown toolchain into its bundle.
import type { Options as SanitizeSchema } from "rehype-sanitize";

export const SANITIZE_SCHEMA_VERSION = "1.0.0";

/** Origins whose images may be rendered (e.g. our own image proxy). Empty ⇒ no remote images. */
export const TRUSTED_IMAGE_ORIGINS: readonly string[] = [];

const ALLOWED_TAGS = [
  "p", "br", "hr", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "strong", "em", "del", "a",
  "table", "thead", "tbody", "tr", "th", "td",
  "img",
];

/**
 * Strict rehype-sanitize schema. Raw HTML never reaches it (react-markdown
 * runs with skipHtml), this is defence in depth for the mdast → hast output.
 *  - no style / class / id / on* attributes (no `clobberPrefix` games needed)
 *  - links: href only, http(s) and mailto only
 *  - images: src http(s) only — further restricted to TRUSTED_IMAGE_ORIGINS by SafeMarkdown
 */
export const SANITIZE_SCHEMA: SanitizeSchema = {
  tagNames: ALLOWED_TAGS,
  // Structural elements only where they make sense (as in rehype-sanitize's default).
  ancestors: {
    li: ["ol", "ul"],
    tbody: ["table"],
    thead: ["table"],
    tr: ["table"],
    th: ["table"],
    td: ["table"],
  },
  attributes: {
    a: ["href", "title"],
    img: ["src", "alt", "title"],
    code: [],
    th: ["align"],
    td: ["align"],
    ol: ["start"],
    li: [],
  },
  protocols: {
    href: ["http", "https", "mailto"],
    src: ["http", "https"],
  },
  // Drop the content of dangerous elements entirely, not just the tags.
  strip: ["script", "style", "iframe", "object", "embed", "noscript", "template", "svg", "math"],
  clobber: [],
  clobberPrefix: "",
  required: {},
  allowComments: false,
  allowDoctypes: false,
};

// ── Text ──────────────────────────────────────────────────────────────────

/** C0 (except \t \n), DEL, C1. */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** Bidi embeddings/overrides/isolates (Trojan Source, RTLO filename spoofing). */
const BIDI_CONTROLS = /[‪-‮⁦-⁩‎‏؜]/g;
/** Zero-width / invisible formatting characters (not ZWJ, which emoji need). */
const INVISIBLE = /[​‌⁠-⁤﻿­᠎]/g;

export const DEFAULT_TEXT_MAX = 500;

export interface SafeTextOptions {
  /** Max length in code points (default 500). Longer text is truncated with "…". */
  maxLength?: number;
  /** Collapse newlines/tabs to spaces (default true — for one-line UI strings). */
  singleLine?: boolean;
}

/**
 * Make a backend-provided string safe for display as text: NFC-normalizes,
 * strips control, bidi and invisible characters, caps length. React escapes
 * HTML on render; this handles what escaping doesn't (spoofing, layout abuse).
 */
export function safeText(input: unknown, { maxLength = DEFAULT_TEXT_MAX, singleLine = true }: SafeTextOptions = {}): string {
  if (input === null || input === undefined) return "";
  let s = typeof input === "string" ? input : String(input);
  // Bound the work before normalizing multi-MB inputs.
  if (s.length > maxLength * 4 + 16) s = s.slice(0, maxLength * 4 + 16);
  s = s.normalize("NFC").replace(CONTROL_CHARS, "").replace(BIDI_CONTROLS, "").replace(INVISIBLE, "");
  if (singleLine) s = s.replace(/[\t\n\r]+/g, " ");
  s = s.trim();
  const points = Array.from(s);
  if (points.length > maxLength) s = points.slice(0, Math.max(0, maxLength - 1)).join("").trimEnd() + "…";
  return s;
}

/**
 * For identifiers (addresses, asset codes, display names) where a hidden
 * character changes meaning: instead of silently removing it, render it
 * visibly as ⟪U+202E⟫ so the user can see something is off.
 */
export function revealInvisible(input: string): { text: string; suspicious: boolean } {
  let suspicious = false;
  const text = input.normalize("NFC").replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩‎‏؜​-‍⁠-⁤﻿­᠎]/g,
    (ch) => {
      suspicious = true;
      return `⟪U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟫`;
    },
  );
  return { text, suspicious };
}

/**
 * For multi-line untrusted prose (markdown source): normalizes newlines,
 * strips control characters, and makes bidi controls visible (⟪U+202E⟫)
 * rather than letting them reorder the page. Keeps ZWJ so emoji survive.
 */
export function prepareProse(input: string): string {
  return input
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .replace(BIDI_CONTROLS, (ch) => `⟪U+${ch.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}⟫`);
}

/** Stellar strkeys are base32 upper-case ASCII only. */
const STRKEY_CHARS = /^[A-Z2-7]+$/;

/**
 * Detect non-ASCII look-alikes (Cyrillic "А", fullwidth "Ａ", Greek "Ο" …) in
 * something that should be a plain Stellar address. Returns the text with
 * each out-of-alphabet character made visible.
 */
export function inspectAddress(address: string): { text: string; suspicious: boolean } {
  if (STRKEY_CHARS.test(address)) return { text: address, suspicious: false };
  const text = Array.from(address)
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      // Visible ASCII is left as-is (it's wrong, but not deceptive).
      if (cp > 0x20 && cp < 0x7f) return ch;
      const hex = cp.toString(16).toUpperCase().padStart(4, "0");
      return /\p{L}|\p{N}/u.test(ch) ? `⟪${ch}:U+${hex}⟫` : `⟪U+${hex}⟫`;
    })
    .join("");
  return { text, suspicious: true };
}

/**
 * Mixed-script check for display names: Latin mixed with Cyrillic/Greek in a
 * single word is the classic homoglyph spoof ("pаypal" with Cyrillic а).
 */
export function hasMixedScripts(input: string): boolean {
  return input.split(/\s+/).some((word) => {
    const latin = /[A-Za-z]/.test(word);
    const confusable = /[Ͱ-ϿЀ-ӿԀ-ԯＡ-ｚ]/.test(word);
    return latin && confusable;
  });
}

// ── URLs ──────────────────────────────────────────────────────────────────

/**
 * Allow only absolute http(s) URLs (and mailto: when `allowMailto`). Returns
 * the normalized href or null. Rejects javascript:, data:, vbscript:, file:,
 * protocol-relative and credentialed URLs. Parsing with URL() defeats
 * whitespace / entity / case tricks ("JaVa\tScRiPt:").
 */
export function safeUrl(input: unknown, { allowMailto = false }: { allowMailto?: boolean } = {}): string | null {
  if (typeof input !== "string") return null;
  const raw = input.replace(CONTROL_CHARS, "").replace(BIDI_CONTROLS, "").replace(INVISIBLE, "").trim();
  if (raw === "" || raw.length > 2048) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return allowMailto ? url.href : null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password) return null;
  return url.href;
}

export function isTrustedImageUrl(src: unknown): boolean {
  const href = safeUrl(src);
  if (!href) return false;
  return TRUSTED_IMAGE_ORIGINS.includes(new URL(href).origin);
}

/** Rel attribute every external link must carry. */
export const EXTERNAL_LINK_REL = "noopener noreferrer nofollow";
