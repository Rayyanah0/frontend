/**
 * markdown.ts — Issue #89: a minimal, safe Markdown subset for the proposal
 * body's live preview.
 *
 * There is no Markdown dependency in the app, and a proposal body is
 * user-authored content that gets shown to everyone voting on it.  This parser
 * therefore produces a structured AST which the preview renders as React
 * elements — there is no `dangerouslySetInnerHTML` anywhere in the path, so a
 * crafted proposal body cannot inject markup or script.
 *
 * Supported: ATX headings, paragraphs, bullet/ordered lists, fenced code,
 * blockquotes, and inline strong / emphasis / code / links.
 */

export type InlineNode =
  | { type: "text"; text: string }
  | { type: "strong"; children: InlineNode[] }
  | { type: "em"; children: InlineNode[] }
  | { type: "code"; text: string }
  | { type: "link"; href: string; children: InlineNode[] };

export type BlockNode =
  | { type: "paragraph"; children: InlineNode[] }
  | { type: "heading"; level: number; children: InlineNode[] }
  | { type: "list"; ordered: boolean; items: InlineNode[][] }
  | { type: "code"; text: string }
  | { type: "quote"; children: BlockNode[] };

/** Only http/https links are rendered; anything else degrades to plain text. */
function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

const INLINE_SOURCE = "(`[^`]+`)|(\\*\\*[^*]+\\*\\*)|(\\*[^*]+\\*)|(\\[[^\\]]+\\]\\([^)\\s]+\\))";

/**
 * Parse the inline span of a single line.
 *
 * A fresh RegExp is built per call: `parseInline` recurses for strong/em/code,
 * and a shared `g`-flagged instance would have its `lastIndex` reset by the
 * inner call, making the outer loop re-match from zero forever.
 */
export function parseInline(src: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern = new RegExp(INLINE_SOURCE, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(src)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: "text", text: src.slice(lastIndex, match.index) });
    }

    const token = match[0];

    if (token.startsWith("`")) {
      nodes.push({ type: "code", text: token.slice(1, -1) });
    } else if (token.startsWith("**")) {
      nodes.push({ type: "strong", children: parseInline(token.slice(2, -2)) });
    } else if (token.startsWith("[")) {
      const linkMatch = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const href = linkMatch ? safeHref(linkMatch[2]) : null;
      if (href && linkMatch) {
        nodes.push({ type: "link", href, children: parseInline(linkMatch[1]) });
      } else {
        // Unsafe scheme or malformed link — keep it as literal text.
        nodes.push({ type: "text", text: token });
      }
    } else {
      nodes.push({ type: "em", children: parseInline(token.slice(1, -1)) });
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < src.length) {
    nodes.push({ type: "text", text: src.slice(lastIndex) });
  }

  return nodes;
}

function parseBlocks(lines: string[], depth = 0): BlockNode[] {
  const blocks: BlockNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i += 1;
      continue;
    }

    // Fenced code — captured verbatim, no inline parsing.
    const fence = /^```\s*([A-Za-z0-9_+-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i]);
        i += 1;
      }
      i += 1; // consume the closing fence (or run off the end safely)
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    // ATX heading
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ""));
        i += 1;
      }
      blocks.push({ type: "quote", children: parseBlocks(quoted, depth + 1) });
      continue;
    }

    // Lists (consecutive bullet or ordered items)
    const bullet = /^[-*+]\s+(.*)$/.exec(line);
    const ordered = /^\d+[.)]\s+(.*)$/.exec(line);
    if (bullet || ordered) {
      const isOrdered = Boolean(ordered);
      const items: InlineNode[][] = [];
      while (i < lines.length) {
        const current = lines[i];
        const asBullet = /^[-*+]\s+(.*)$/.exec(current);
        const asOrdered = /^\d+[.)]\s+(.*)$/.exec(current);
        const asItem = isOrdered ? asOrdered : asBullet;
        if (!asItem) break;
        items.push(parseInline(asItem[1]));
        i += 1;
      }
      blocks.push({ type: "list", ordered: isOrdered, items });
      continue;
    }

    // Paragraph — consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      const current = lines[i];
      const startsBlock =
        /^```/.test(current) ||
        /^#{1,6}\s/.test(current) ||
        /^>\s?/.test(current) ||
        /^[-*+]\s+/.test(current) ||
        /^\d+[.)]\s+/.test(current);

      // Always make progress: a lone ``` that did not open a valid fence must
      // still be consumed, otherwise this loop would spin forever.
      if (startsBlock && paragraph.length > 0) break;
      paragraph.push(current);
      i += 1;
    }
    blocks.push({ type: "paragraph", children: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/** Parse a Markdown document into blocks. */
export function parseMarkdown(src: string): BlockNode[] {
  if (typeof src !== "string" || src.trim() === "") return [];
  return parseBlocks(src.replace(/\r\n/g, "\n").split("\n"));
}

/** Flatten a block list back to plain text — used for summaries and tests. */
export function blocksToPlainText(blocks: BlockNode[]): string {
  const parts: string[] = [];
  const inlineText = (nodes: InlineNode[]): string =>
    nodes
      .map((n) => {
        switch (n.type) {
          case "text":
            return n.text;
          case "code":
            return n.text;
          case "link":
            return `${inlineText(n.children)} (${n.href})`;
          default:
            return inlineText(n.children);
        }
      })
      .join("");

  for (const block of blocks) {
    switch (block.type) {
      case "heading":
      case "paragraph":
        parts.push(inlineText(block.children));
        break;
      case "code":
        parts.push(block.text);
        break;
      case "quote":
        parts.push(blocksToPlainText(block.children));
        break;
      case "list":
        parts.push(block.items.map(inlineText).join(" "));
        break;
    }
  }
  return parts.join("\n");
}
