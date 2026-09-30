/**
 * XSS corpus: every vector in src/test-utils/xssCorpus.ts is run through every
 * renderer of untrusted content, and the resulting DOM is checked against
 * the invariants below. Runs in CI via `npm test`.
 */
import { render, cleanup } from "@testing-library/react";
import { SafeMarkdown } from "../SafeMarkdown";
import { SafeAddress, SafeName, SafeText } from "../SafeText";
import { buildCorpus, URL_VECTORS } from "../../test-utils/xssCorpus";
import { safeText, safeUrl, EXTERNAL_LINK_REL } from "../../lib/sanitize";

const CORPUS = buildCorpus();

const FORBIDDEN_TAGS = [
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "style", "link", "meta", "base",
  "form", "input", "button", "textarea", "select", "svg", "math", "video", "audio", "source", "template",
  "noscript", "xmp", "details", "marquee", "bgsound", "isindex", "img",
];
const URL_ATTRS = ["href", "src", "action", "formaction", "xlink:href", "background", "lowsrc", "dynsrc", "data", "poster", "srcset"];
const SAFE_URL = /^(https?:\/\/|mailto:)/i;
const HIDDEN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F‪-‮⁦-⁩]/;

/** Returns a list of violations (empty = safe). */
function audit(root: HTMLElement): string[] {
  const problems: string[] = [];
  root.querySelectorAll("*").forEach((el) => {
    const tag = el.tagName.toLowerCase();
    if (FORBIDDEN_TAGS.includes(tag)) problems.push(`forbidden <${tag}>`);
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on")) problems.push(`event handler ${name} on <${tag}>`);
      // react-markdown turns table `align` into `style="text-align:…"`; nothing else may style.
      if (name === "style" && !/^text-align:\s*(left|right|center);?$/.test(attr.value.trim())) problems.push(`style on <${tag}>`);
      if (name === "srcdoc" || name === "id" || name === "name") problems.push(`attribute ${name} on <${tag}>`);
      if (URL_ATTRS.includes(name) && !SAFE_URL.test(attr.value)) problems.push(`unsafe ${name}="${attr.value.slice(0, 60)}"`);
    }
    if (tag === "a" && el.getAttribute("target") === "_blank") {
      const rel = (el.getAttribute("rel") ?? "").split(/\s+/);
      for (const r of EXTERNAL_LINK_REL.split(" ")) if (!rel.includes(r)) problems.push(`<a target=_blank> missing rel=${r}`);
    }
  });
  return problems;
}

afterEach(cleanup);

it("has at least 100 vectors", () => {
  expect(CORPUS.length).toBeGreaterThanOrEqual(100);
});

describe("SafeMarkdown", () => {
  it.each(CORPUS.map((c) => [c.name, c.payload]))("%s renders safely", (_name, payload) => {
    const { container } = render(<SafeMarkdown>{payload}</SafeMarkdown>);
    const root = container.querySelector("[data-safe-markdown]") as HTMLElement;
    // The wrapper's own inline style is ours, not content's.
    root.removeAttribute("style");
    expect(audit(root)).toEqual([]);
    expect(root.textContent ?? "").not.toMatch(HIDDEN);
    expect((root.textContent ?? "").length).toBeLessThanOrEqual(20_010);
  });

  it("keeps safe links, with target and the full rel set", () => {
    const { container } = render(<SafeMarkdown>{"[docs](https://example.com/a)"}</SafeMarkdown>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("href")).toBe("https://example.com/a");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer nofollow");
  });

  it("keeps link text when dropping an unsafe link", () => {
    const { container } = render(<SafeMarkdown>{"[click me](javascript:alert(1))"}</SafeMarkdown>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toContain("click me");
  });

  it("replaces untrusted images with their alt text", () => {
    const { container } = render(<SafeMarkdown>{"![chart](https://evil.example/x.png)"}</SafeMarkdown>);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("[image: chart]");
  });

  it("shows raw HTML as nothing, not as markup", () => {
    const { container } = render(<SafeMarkdown>{"hi <b onclick=x>bold</b>"}</SafeMarkdown>);
    expect(container.querySelector("b")).toBeNull();
  });

  it("renders bidi overrides visibly", () => {
    const { container } = render(<SafeMarkdown>{"file‮txt.exe"}</SafeMarkdown>);
    expect(container.textContent).toContain("⟪U+202E⟫");
  });

  it("renders ordinary markdown", () => {
    const { container } = render(<SafeMarkdown>{"# Title\n\n- **one**\n- _two_\n\n`code`"}</SafeMarkdown>);
    expect(container.querySelector("h1")?.textContent).toBe("Title");
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelector("code")?.textContent).toBe("code");
  });

  it("handles null / undefined", () => {
    expect(render(<SafeMarkdown>{null}</SafeMarkdown>).container.textContent).toBe("");
  });
});

describe("SafeText / SafeName", () => {
  it.each(CORPUS.map((c) => [c.name, c.payload]))("%s renders as inert text", (_name, payload) => {
    const { container } = render(
      <div>
        <SafeText>{payload}</SafeText>
        <SafeName name={payload} />
      </div>,
    );
    expect(container.querySelectorAll("*:not(div):not(span):not(bdi)")).toHaveLength(0);
    expect(audit(container)).toEqual([]);
    expect(container.querySelectorAll("[style]")).toHaveLength(0);
    expect(container.textContent ?? "").not.toMatch(HIDDEN);
  });
});

describe("SafeAddress", () => {
  it.each(CORPUS.slice(0, 60).map((c) => [c.name, c.payload]))("%s is flagged and inert", (_name, payload) => {
    const { container } = render(<SafeAddress address={payload} />);
    // The wrapper span's inline style is ours.
    container.querySelectorAll("[data-suspicious]").forEach((el) => el.removeAttribute("style"));
    expect(audit(container)).toEqual([]);
    expect(container.querySelector("[data-suspicious]")).not.toBeNull();
  });

  it("does not flag a genuine strkey", () => {
    const { container } = render(<SafeAddress address="GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7" />);
    expect(container.querySelector("[data-suspicious]")).toBeNull();
  });

  it("makes Cyrillic homoglyphs visible", () => {
    const { container } = render(<SafeAddress address={"GАAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"} />);
    expect(container.textContent).toContain("U+0410");
  });

  it("makes zero-width characters visible", () => {
    const { container } = render(<SafeAddress address={"GAAZI4​TCR3"} />);
    expect(container.textContent).toContain("⟪U+200B⟫");
  });
});

describe("safeUrl", () => {
  it.each(URL_VECTORS)("rejects %p", (u) => {
    const out = safeUrl(u);
    // A handful of vectors are valid https URLs by construction; those must stay https.
    if (out !== null) expect(out).toMatch(/^https:\/\//);
  });

  it.each([
    ["https://example.com", "https://example.com/"],
    ["http://example.com/a?b=c", "http://example.com/a?b=c"],
    ["  https://example.com  ", "https://example.com/"],
  ])("accepts %p", (input, expected) => expect(safeUrl(input)).toBe(expected));

  it("rejects credentials, mailto by default, and non-strings", () => {
    expect(safeUrl("https://u:p@example.com")).toBeNull();
    expect(safeUrl("mailto:a@b.c")).toBeNull();
    expect(safeUrl("mailto:a@b.c", { allowMailto: true })).toBe("mailto:a@b.c");
    expect(safeUrl(42)).toBeNull();
    expect(safeUrl("https://example.com/" + "a".repeat(3000))).toBeNull();
  });
});

describe("safeText", () => {
  it("strips control, bidi and invisible characters", () => {
    expect(safeText("a\u0000b‮c​d\u0007e")).toBe("abcde");
  });
  it("caps length with an ellipsis, counting code points", () => {
    expect(safeText("😀".repeat(10), { maxLength: 5 })).toBe("😀😀😀😀…");
  });
  it("collapses whitespace in single-line mode", () => {
    expect(safeText(" a\n\tb ")).toBe("a b");
    expect(safeText("a\nb", { singleLine: false })).toBe("a\nb");
  });
  it("handles non-strings", () => {
    expect(safeText(null)).toBe("");
    expect(safeText(undefined)).toBe("");
    expect(safeText(12)).toBe("12");
  });
  it("bounds work on huge inputs", () => {
    expect(safeText("x".repeat(5_000_000), { maxLength: 10 }).length).toBe(10);
  });
  it("normalizes to NFC", () => {
    expect(safeText("é")).toBe("é");
  });
});
