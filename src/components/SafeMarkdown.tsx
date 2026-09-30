"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize from "rehype-sanitize";
import {
  EXTERNAL_LINK_REL,
  SANITIZE_SCHEMA,
  isTrustedImageUrl,
  prepareProse,
  safeUrl,
} from "../lib/sanitize";

/** Hard cap on source length; longer content is truncated before parsing. */
export const SAFE_MARKDOWN_MAX_CHARS = 20_000;

interface HastNode {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  value?: string;
}

/**
 * rehype plugin, runs AFTER rehype-sanitize:
 *  - drops <img> unless its origin is in TRUSTED_IMAGE_ORIGINS (the image
 *    proxy); replaces it with its alt text so content isn't silently lost
 *  - makes every link external-safe: target=_blank + rel="noopener noreferrer nofollow"
 */
function rehypeLinkAndImagePolicy() {
  const walk = (node: HastNode) => {
    if (!node.children) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type === "element" && child.tagName === "img") {
        if (isTrustedImageUrl(child.properties?.src)) {
          child.properties = { ...child.properties, loading: "lazy", referrerPolicy: "no-referrer" };
          return [child];
        }
        const alt = typeof child.properties?.alt === "string" ? child.properties.alt : "";
        return alt ? [{ type: "text", value: `[image: ${alt}]` }] : [];
      }
      if (child.type === "element" && child.tagName === "a") {
        const href = safeUrl(child.properties?.href, { allowMailto: true });
        if (!href) {
          // Unsafe/relative link: keep the text, drop the anchor.
          walk(child);
          return child.children ?? [];
        }
        child.properties = { ...child.properties, href, target: "_blank", rel: EXTERNAL_LINK_REL.split(" ") };
      }
      walk(child);
      return [child];
    });
  };
  return (tree: HastNode) => walk(tree);
}

/** Anchor renderer: second, independent protocol check at the last moment. */
const components: Components = {
  a: ({ href, children, title }) => {
    const safe = safeUrl(href, { allowMailto: true });
    if (!safe) return <>{children}</>;
    return (
      <a href={safe} title={title} target="_blank" rel={EXTERNAL_LINK_REL}>
        {children}
      </a>
    );
  },
};

/** Markdown AST → URL transform: anything not http(s)/mailto becomes empty. */
function urlTransform(url: string): string {
  return safeUrl(url, { allowMailto: true }) ?? "";
}

export interface SafeMarkdownProps {
  /** Untrusted markdown (proposal, delegate statement, strategy description …). */
  children: string | null | undefined;
  className?: string;
  style?: React.CSSProperties;
  maxChars?: number;
}

/**
 * The ONLY way to render user-generated markdown. Raw HTML is skipped
 * entirely (skipHtml) and the resulting tree is sanitized with the single
 * versioned SANITIZE_SCHEMA. Never passes content through
 * dangerouslySetInnerHTML.
 */
export function SafeMarkdown({ children, className, style, maxChars = SAFE_MARKDOWN_MAX_CHARS }: SafeMarkdownProps) {
  let source = typeof children === "string" ? children : "";
  if (source.length > maxChars) source = source.slice(0, maxChars) + "\n\n…";
  // Strip control chars; bidi overrides would reorder surrounding UI, so show them instead.
  source = prepareProse(source);

  return (
    <div className={className} style={{ overflowWrap: "anywhere", ...style }} data-safe-markdown="">
      <ReactMarkdown
        skipHtml
        urlTransform={urlTransform}
        rehypePlugins={[[rehypeSanitize, SANITIZE_SCHEMA], rehypeLinkAndImagePolicy]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
