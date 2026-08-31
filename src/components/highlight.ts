import type { Element, ElementContent, Root } from "hast";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import shell from "highlight.js/lib/languages/shell";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { createLowlight } from "lowlight";
import { visit } from "unist-util-visit";

/**
 * The languages a reply is likely to contain code in.
 *
 * `typescript` covers JavaScript, `xml` covers HTML, and `shell` is the transcript form that
 * `bash` is not. Anything outside this list still renders — it just falls through to
 * auto-detection against these, and failing that comes out unhighlighted, which is a far
 * better trade than it sounds: highlight.js has 190-odd languages and lowlight's default set
 * alone was 159 kB of the bundle, most of it for languages nothing here has ever emitted.
 */
const lowlight = createLowlight({
  bash,
  css,
  go,
  json,
  markdown,
  python,
  rust,
  shell,
  sql,
  typescript,
  xml,
  yaml,
});

const languageOf = (node: Element) => {
  const classes = node.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  for (const value of classes) {
    const match = /^language-(.+)$/.exec(String(value));
    if (match) return match[1];
  }
  return undefined;
};

/**
 * Syntax highlighting for fenced code, in place of `rehype-highlight`.
 *
 * It is the same lowlight underneath and produces the same `hljs-*` class names, so the
 * stylesheet is unchanged. What it does not do is import lowlight's `common` registry:
 * `rehype-highlight` names that as the default in its own module, which puts all 37 of those
 * languages in the graph whether or not a `languages` option overrides them. Registering the
 * set directly is the only way to actually pay for what is used.
 */
export function rehypeHighlight() {
  return (tree: Root) => {
    visit(tree, "element", (node: Element, _index, parent) => {
      if (node.tagName !== "code") return;
      if (parent?.type !== "element" || parent.tagName !== "pre") return;

      const [child] = node.children;
      if (child?.type !== "text") return;

      const language = languageOf(node);
      const result =
        language && lowlight.registered(language)
          ? lowlight.highlight(language, child.value)
          : lowlight.highlightAuto(child.value);

      // lowlight hands back a `Root`, whose children are typed wide enough to include a
      // doctype. A highlighter emits only elements and text; the filter says so to the types.
      node.children = result.children.filter(
        (child): child is ElementContent => child.type === "element" || child.type === "text",
      );
      const classes = node.properties.className;
      node.properties.className = [...(Array.isArray(classes) ? classes : []), "hljs"];
    });
  };
}
