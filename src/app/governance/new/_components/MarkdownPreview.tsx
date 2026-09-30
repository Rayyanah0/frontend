"use client";

/**
 * Live Markdown preview for the proposal body.
 *
 * Renders the AST produced by `lib/governance/markdown` as React elements — no
 * `dangerouslySetInnerHTML`, so a proposal body can never inject markup.
 */

import type { CSSProperties, ReactNode } from "react";
import { parseMarkdown, type BlockNode, type InlineNode } from "../../../../lib/governance/markdown";

function renderInline(nodes: InlineNode[], keyPrefix = ""): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`;
    switch (node.type) {
      case "text":
        return <span key={key}>{node.text}</span>;
      case "strong":
        return <strong key={key}>{renderInline(node.children, key)}</strong>;
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "code":
        return (
          <code
            key={key}
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              background: "var(--bg-overlay)",
              padding: "1px 4px",
            }}
          >
            {node.text}
          </code>
        );
      case "link":
        return (
          <a
            key={key}
            href={node.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            style={{ color: "var(--brand)" }}
          >
            {renderInline(node.children, key)}
          </a>
        );
    }
  });
}

function renderBlock(block: BlockNode, key: string): ReactNode {
  switch (block.type) {
    case "heading": {
      const size = [20, 17, 15, 14, 13, 13][block.level - 1] ?? 13;
      return (
        <div
          key={key}
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: size,
            fontWeight: 600,
            color: "var(--text-hi)",
            margin: "16px 0 8px",
          }}
        >
          {renderInline(block.children, key)}
        </div>
      );
    }
    case "paragraph":
      return (
        <p key={key} style={{ fontSize: 13, lineHeight: 1.7, color: "var(--text-mid)", marginBottom: 10 }}>
          {renderInline(block.children, key)}
        </p>
      );
    case "code":
      return (
        <pre
          key={key}
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            background: "var(--bg-overlay)",
            border: "1px solid var(--border-default)",
            padding: "10px 12px",
            overflowX: "auto",
            marginBottom: 10,
          }}
        >
          {block.text}
        </pre>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          style={{
            borderLeft: "2px solid var(--border-strong)",
            paddingLeft: 12,
            margin: "0 0 10px",
            color: "var(--text-lo)",
          }}
        >
          {block.children.map((child, i) => renderBlock(child, `${key}-q${i}`))}
        </blockquote>
      );
    case "list":
      return block.ordered ? (
        <ol key={key} style={{ ...LIST_STYLE, marginBottom: 10 }}>
          {block.items.map((item, i) => (
            <li key={`${key}-${i}`} style={ITEM_STYLE}>
              {renderInline(item, `${key}-${i}`)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={key} style={{ ...LIST_STYLE, marginBottom: 10 }}>
          {block.items.map((item, i) => (
            <li key={`${key}-${i}`} style={ITEM_STYLE}>
              {renderInline(item, `${key}-${i}`)}
            </li>
          ))}
        </ul>
      );
  }
}

const LIST_STYLE: CSSProperties = { paddingLeft: 20, listStyle: "revert" };
const ITEM_STYLE: CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  color: "var(--text-mid)",
  marginBottom: 4,
};

export function MarkdownPreview({ source }: { source: string }) {
  const blocks = parseMarkdown(source);

  if (blocks.length === 0) {
    return (
      <div
        data-testid="markdown-empty"
        style={{ fontSize: 12, color: "var(--text-lo)", fontStyle: "italic", padding: "8px 0" }}
      >
        Nothing to preview yet — the rendered description appears here.
      </div>
    );
  }

  return <div data-testid="markdown-preview">{blocks.map((b, i) => renderBlock(b, `b${i}`))}</div>;
}
