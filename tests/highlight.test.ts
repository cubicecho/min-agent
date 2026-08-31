import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import { rehypeHighlight } from "../src/components/highlight.ts";

/**
 * The highlighter is hand-rolled over lowlight rather than `rehype-highlight`, to keep the
 * languages nothing here emits out of the bundle. These check that the swap kept the part
 * that shows: `hljs-*` classes on the right tokens, for the languages replies actually use.
 */
const fence = (language: string | null, code: string): Root => ({
  type: "root",
  children: [
    {
      type: "element",
      tagName: "pre",
      properties: {},
      children: [
        {
          type: "element",
          tagName: "code",
          properties: language ? { className: [`language-${language}`] } : {},
          children: [{ type: "text", value: code }],
        },
      ],
    },
  ],
});

function highlight(tree: Root) {
  rehypeHighlight()(tree);
  const pre = tree.children[0] as Element;
  return pre.children[0] as Element;
}

const classesIn = (node: Element): string[] =>
  node.children.flatMap((child) =>
    child.type === "element"
      ? [...((child.properties.className as string[] | undefined) ?? []), ...classesIn(child)]
      : [],
  );

describe("rehypeHighlight", () => {
  it("marks up a fenced block in a registered language", () => {
    const code = highlight(fence("typescript", "const answer = 42;"));

    expect(code.properties.className).toContain("hljs");
    expect(classesIn(code)).toContain("hljs-keyword");
  });

  it("keeps the language class the fence asked for", () => {
    const code = highlight(fence("python", "def f():\n    return 1\n"));

    expect(code.properties.className).toEqual(["language-python", "hljs"]);
  });

  it("falls back to auto-detection when the fence names nothing", () => {
    const code = highlight(fence(null, "SELECT * FROM sessions WHERE id = '1';"));

    expect(code.properties.className).toContain("hljs");
    expect(classesIn(code).length).toBeGreaterThan(0);
  });

  it("leaves an unregistered language readable rather than dropping it", () => {
    const code = highlight(fence("brainfuck", "++++[>++++<-]>."));

    // Auto-detection may match nothing here; what matters is the text survives intact.
    expect(code.properties.className).toContain("hljs");
    const text = JSON.stringify(code.children);
    expect(text).toContain("++++");
  });

  it("ignores inline code, which has no `pre` around it", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "p",
          properties: {},
          children: [
            {
              type: "element",
              tagName: "code",
              properties: { className: ["language-ts"] },
              children: [{ type: "text", value: "const x = 1" }],
            },
          ],
        },
      ],
    };
    rehypeHighlight()(tree);

    const paragraph = tree.children[0] as Element;
    const code = paragraph.children[0] as Element;
    expect(code.properties.className).toEqual(["language-ts"]);
    expect(code.children).toEqual([{ type: "text", value: "const x = 1" }]);
  });
});
