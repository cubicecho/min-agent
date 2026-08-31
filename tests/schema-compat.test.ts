import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { isGrammarError, relaxTools, sanitizeTools } from "../server/schema-compat.ts";

const tool = (parameters: unknown): OpenAI.ChatCompletionTool => ({
  type: "function",
  function: { name: "t", parameters: parameters as Record<string, unknown> },
});

const params = (tools: OpenAI.ChatCompletionTool[]) =>
  (tools[0] as { function: { parameters: Record<string, unknown> } }).function.parameters;

describe("sanitizeTools", () => {
  it("gives bare object schemas an empty properties map", () => {
    expect(params(sanitizeTools([tool({ type: "object" })]))).toEqual({
      type: "object",
      properties: {},
    });
  });

  it("replaces a bare string used where a schema belongs", () => {
    const out = params(sanitizeTools([tool({ type: "object", properties: { a: "object" } })]));
    expect(out.properties).toEqual({ a: { type: "object", properties: {} } });
  });

  it("collapses a nullable type array to a single type", () => {
    const out = params(sanitizeTools([tool({ properties: { a: { type: ["string", "null"] } } })]));
    expect(out.properties).toEqual({ a: { nullable: true, type: "string" } });
  });

  it("turns a multi-type array into anyOf", () => {
    const out = params(
      sanitizeTools([tool({ properties: { a: { type: ["string", "number"] } } })]),
    );
    expect(out.properties).toEqual({ a: { anyOf: [{ type: "string" }, { type: "number" }] } });
  });

  it("collapses a nullable anyOf union to its one real branch", () => {
    const out = params(
      sanitizeTools([
        tool({
          properties: { a: { anyOf: [{ type: "string", maxLength: 3 }, { type: "null" }] } },
        }),
      ]),
    );
    expect(out.properties).toEqual({ a: { nullable: true, type: "string", maxLength: 3 } });
  });

  it("leaves a union of two real branches alone", () => {
    const anyOf = [{ type: "string" }, { type: "number" }];
    const out = params(sanitizeTools([tool({ properties: { a: { anyOf } } })]));
    expect(out.properties).toEqual({ a: { anyOf } });
  });

  it("drops a default sitting beside a $ref", () => {
    const out = params(
      sanitizeTools([tool({ properties: { a: { $ref: "#/defs/X", default: 1 } } })]),
    );
    expect(out.properties).toEqual({ a: { $ref: "#/defs/X" } });
  });

  it("strips top-level combinators", () => {
    const out = params(sanitizeTools([tool({ type: "object", properties: {}, oneOf: [{}] })]));
    expect(out).toEqual({ type: "object", properties: {} });
  });

  it("substitutes an object schema for a missing one", () => {
    expect(params(sanitizeTools([tool(undefined)]))).toEqual({ type: "object", properties: {} });
  });

  it("drops a pattern using lookaround, which no grammar can express", () => {
    const out = params(
      sanitizeTools([
        tool({ properties: { to: { type: "string", pattern: "^(?!\\.)[a-z]+$", maxLength: 9 } } }),
      ]),
    );
    expect(out.properties).toEqual({ to: { type: "string", maxLength: 9 } });
  });

  it("keeps a pattern a grammar can express", () => {
    const out = params(
      sanitizeTools([tool({ properties: { hex: { type: "string", pattern: "^#[0-9a-f]{6}$" } } })]),
    );
    expect(out.properties).toEqual({ hex: { type: "string", pattern: "^#[0-9a-f]{6}$" } });
  });

  it("keeps nested descriptions and enums", () => {
    const schema = {
      type: "object",
      properties: { mode: { type: "string", enum: ["a", "b"], description: "how" } },
      required: ["mode"],
    };
    expect(params(sanitizeTools([tool(schema)]))).toEqual(schema);
  });
});

describe("relaxTools", () => {
  it("removes pattern and format at any depth", () => {
    const out = params(
      relaxTools([
        tool({
          type: "object",
          properties: {
            page: { type: "string", pattern: "^\\d+$" },
            items: { type: "array", items: { type: "string", format: "uri" } },
          },
        }),
      ]),
    );
    expect(out.properties).toEqual({
      page: { type: "string" },
      items: { type: "array", items: { type: "string" } },
    });
  });
});

describe("isGrammarError", () => {
  it.each([
    "HTTP 400: Unable to generate parser for this template",
    "400 Failed to initialize samplers: failed to parse grammar",
    "json-schema-to-grammar: unsupported keyword",
    "Error parsing grammar: expecting name at",
    'JSON schema conversion failed: Unrecognized schema: "object"',
  ])("matches %s", (message) => {
    expect(isGrammarError(message)).toBe(true);
  });

  it("ignores a poisoned transcript wearing the same wording", () => {
    expect(isGrammarError("Unable to generate parser for this template: No user query found")).toBe(
      false,
    );
  });

  it("ignores unrelated failures", () => {
    expect(isGrammarError("context length exceeded")).toBe(false);
  });
});
