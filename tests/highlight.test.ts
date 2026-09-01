import { describe, expect, it } from "vitest";
import { registered, tokenize, tokenizeLines } from "../shared/highlight.ts";

/**
 * The highlighter is hand-rolled over lowlight rather than a rehype plugin, to keep the
 * languages nothing here emits out of the bundle. These check the part that shows: the right
 * scopes on the right tokens, for the languages replies actually use, and — since the renderer
 * lays out one row per line — that no token loses text on the way through.
 */
const scopes = (tokens: { scope?: string }[]) => tokens.map((token) => token.scope);
const text = (tokens: { text: string }[]) => tokens.map((token) => token.text).join("");

describe("tokenize", () => {
  it("scopes a block in a registered language", () => {
    const tokens = tokenize("const answer = 42;", "typescript");

    expect(scopes(tokens)).toContain("keyword");
    expect(text(tokens)).toBe("const answer = 42;");
  });

  it("keeps every character, whatever the language", () => {
    const code = "def f():\n    return 1\n";

    expect(text(tokenize(code, "python"))).toBe(code);
  });

  it("falls back to auto-detection when the fence names nothing", () => {
    const tokens = tokenize("SELECT * FROM sessions WHERE id = '1';");

    expect(text(tokens)).toBe("SELECT * FROM sessions WHERE id = '1';");
    expect(scopes(tokens).some(Boolean)).toBe(true);
  });

  it("leaves an unregistered language readable rather than dropping it", () => {
    const code = "++++[>++++<-]>.";

    // Auto-detection may match nothing here; what matters is the text survives intact.
    expect(registered("brainfuck")).toBe(false);
    expect(text(tokenize(code, "brainfuck"))).toBe(code);
  });

  it("takes the innermost scope where highlight.js nests them", () => {
    // `function f` puts a `title` inside a `function`, and `title` is the one CSS would paint.
    const tokens = tokenize("function f() {}", "typescript");

    expect(scopes(tokens)).toContain("title");
  });
});

describe("tokenizeLines", () => {
  it("cuts a token that straddles a newline", () => {
    const lines = tokenizeLines("/* one\n   two */", "typescript");

    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line.every((token) => !token.text.includes("\n")))).toBe(true);
    expect(lines.map(text)).toEqual(["/* one", "   two */"]);
  });

  it("does not leave a blank row for a trailing newline", () => {
    expect(tokenizeLines("a = 1\n", "python")).toHaveLength(1);
  });

  it("keeps a blank line in the middle, which is real", () => {
    expect(tokenizeLines("a = 1\n\nb = 2", "python")).toHaveLength(3);
  });
});
