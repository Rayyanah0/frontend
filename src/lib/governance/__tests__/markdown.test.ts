import {
  blocksToPlainText,
  parseInline,
  parseMarkdown,
  type BlockNode,
} from "../markdown";

describe("parseInline", () => {
  it("returns plain text unchanged", () => {
    expect(parseInline("plain text")).toEqual([{ type: "text", text: "plain text" }]);
  });

  it("parses bold and italic", () => {
    expect(parseInline("a **bold** and *italic*")).toEqual([
      { type: "text", text: "a " },
      { type: "strong", children: [{ type: "text", text: "bold" }] },
      { type: "text", text: " and " },
      { type: "em", children: [{ type: "text", text: "italic" }] },
    ]);
  });

  it("parses inline code without treating its contents as markup", () => {
    expect(parseInline("run `a **b** c` now")).toEqual([
      { type: "text", text: "run " },
      { type: "code", text: "a **b** c" },
      { type: "text", text: " now" },
    ]);
  });

  it("parses safe http and https links", () => {
    const [link] = parseInline("[forum](https://forum.example.com/t/1)");
    expect(link).toEqual({
      type: "link",
      href: "https://forum.example.com/t/1",
      children: [{ type: "text", text: "forum" }],
    });
  });

  it("refuses javascript: links and keeps them as text", () => {
    const nodes = parseInline("[click](javascript:alert(1))");
    expect(nodes.every((n) => n.type === "text")).toBe(true);
    expect(blocksToPlainText([{ type: "paragraph", children: nodes }])).toContain("javascript:");
  });

  it("refuses data: links and keeps them as text", () => {
    expect(parseInline("[x](data:text/html;base64,PHN2Zz4=)").every((n) => n.type === "text")).toBe(true);
  });

  it("refuses vbscript: links", () => {
    expect(parseInline("[x](vbscript:msgbox)").every((n) => n.type === "text")).toBe(true);
  });

  it("keeps a malformed link as literal text", () => {
    const nodes = parseInline("[broken](not a url)");
    expect(nodes.every((n) => n.type === "text")).toBe(true);
  });
});

describe("parseMarkdown", () => {
  it("returns nothing for empty or whitespace input", () => {
    expect(parseMarkdown("")).toEqual([]);
    expect(parseMarkdown("   \n  ")).toEqual([]);
  });

  it("parses ATX headings at every level", () => {
    const blocks = parseMarkdown("# One\n## Two\n###### Six");
    expect(blocks.map((b) => (b as Extract<BlockNode, { type: "heading" }>).level)).toEqual([
      1, 2, 6,
    ]);
  });

  it("joins a wrapped paragraph into one block", () => {
    const blocks = parseMarkdown("line one\nline two\n\nnext para");
    expect(blocks).toHaveLength(2);
    expect(blocksToPlainText([blocks[0]])).toBe("line one line two");
  });

  it("parses fenced code verbatim without inline parsing", () => {
    const [block] = parseMarkdown("```rust\nlet x = **not bold**;\n```");
    expect(block).toEqual({ type: "code", text: "let x = **not bold**;" });
  });

  it("does not crash on an unterminated code fence", () => {
    const [block] = parseMarkdown("```\nunclosed");
    expect(block).toEqual({ type: "code", text: "unclosed" });
  });

  it("parses bullet and ordered lists", () => {
    const blocks = parseMarkdown("- one\n- two\n\n1. first\n2. second");
    expect(blocks[0]).toMatchObject({ type: "list", ordered: false });
    expect(blocks[1]).toMatchObject({ type: "list", ordered: true });
    expect((blocks[1] as Extract<BlockNode, { type: "list" }>).items).toHaveLength(2);
  });

  it("parses blockquotes and recurses into them", () => {
    const blocks = parseMarkdown("> ## Heads up\n> body text");
    const quote = blocks[0] as Extract<BlockNode, { type: "quote" }>;
    expect(quote.type).toBe("quote");
    expect(quote.children.map((c) => c.type)).toEqual(["heading", "paragraph"]);
  });

  it("normalises CRLF line endings", () => {
    expect(blocksToPlainText(parseMarkdown("a\r\nb"))).toBe("a b");
  });

  it("handles a realistic proposal body", () => {
    const body = [
      "## Rationale",
      "",
      "The **short put** collateral ratio is too loose after the volatility review.",
      "",
      "- Raise to `120%`",
      "- Add a guardian check",
      "",
      "> Reviewed by the risk committee.",
      "",
      "See [the thread](https://forum.example.com/t/9).",
    ].join("\n");

    const blocks = parseMarkdown(body);
    expect(blocks.map((b) => b.type)).toEqual([
      "heading",
      "paragraph",
      "list",
      "quote",
      "paragraph",
    ]);
    expect(blocksToPlainText(blocks)).toContain("The short put collateral ratio");
  });
});
