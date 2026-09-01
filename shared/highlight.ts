import type { Element, Root } from "hast";
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

/**
 * A run of code that shares one colour.
 *
 * `scope` is the highlight.js class with its `hljs-` prefix taken off — `keyword`, `string`,
 * `comment` — or absent for text the grammar did not classify. Deliberately not a colour:
 * this module knows what a token *is*, and the renderer knows what the theme paints it.
 */
export interface Token {
  text: string;
  scope?: string;
}

/** Whether a fence's language tag is one of the registered grammars. */
export const registered = (language: string) => lowlight.registered(language);

const scopeOf = (node: Element): string | undefined => {
  const classes = node.properties?.className;
  if (!Array.isArray(classes)) return undefined;
  for (const value of classes) {
    const name = String(value);
    if (name.startsWith("hljs-")) return name.slice(5);
  }
  return undefined;
};

/**
 * Flattens the tree lowlight returns into a list of runs.
 *
 * Spans nest — a `title` inside a `function`, say — and the innermost is the one CSS would
 * have painted, so a child's scope replaces its parent's rather than being merged with it.
 */
function flatten(nodes: Root["children"] | Element["children"], scope: string | undefined) {
  const tokens: Token[] = [];
  for (const node of nodes) {
    if (node.type === "text") {
      if (node.value) tokens.push(scope ? { text: node.value, scope } : { text: node.value });
    } else if (node.type === "element") {
      tokens.push(...flatten(node.children, scopeOf(node) ?? scope));
    }
  }
  return tokens;
}

/**
 * Splits a block of code into coloured runs.
 *
 * Named language first, auto-detection second, and if neither matches, the code comes back as
 * one unscoped token — which is exactly the plain-text rendering, so a caller never has to
 * special-case a language it does not know.
 */
export function tokenize(code: string, language?: string | null): Token[] {
  const result =
    language && lowlight.registered(language)
      ? lowlight.highlight(language, code)
      : lowlight.highlightAuto(code);

  const tokens = flatten(result.children, undefined);
  return tokens.length > 0 ? tokens : [{ text: code }];
}

/**
 * Groups tokens into lines.
 *
 * A token can straddle a newline — a block comment is one run over five lines — and React
 * Native has no `white-space: pre`, so the renderer lays out one row per line and needs the
 * runs already cut at the boundaries.
 */
export function tokenizeLines(code: string, language?: string | null): Token[][] {
  const lines: Token[][] = [[]];
  for (const token of tokenize(code, language)) {
    const parts = token.text.split("\n");
    parts.forEach((part, index) => {
      if (index > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ ...token, text: part });
    });
  }
  // A trailing newline makes an empty last line that would render as a blank row.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}
