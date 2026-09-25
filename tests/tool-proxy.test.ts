import type { CatalogServer } from "@cubicecho/agent-core";
import { expandNames } from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { describe, expect, it } from "vitest";
import {
  PROXY_TOOLS,
  proxiedCall,
  proxyCatalogPrompt,
  proxyLoadResult,
} from "../server/tool-proxy.ts";
import { CALL_TOOL, shownCall } from "../shared/tool-proxy.ts";

const catalog = [
  {
    label: "Files",
    tools: [
      { name: "fs__read", description: "Read a file." },
      { name: "fs__write", description: "Write a file." },
    ],
  },
] as CatalogServer[];

const definition = (name: string): ToolDefinition => ({
  type: "function",
  function: {
    name,
    description: `Does ${name}.`,
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
});

describe("proxied tool discovery", () => {
  it("declares only load_tools and call_tool", () => {
    expect(PROXY_TOOLS.map((tool) => tool.function.name)).toEqual(["load_tools", CALL_TOOL]);
  });

  it("points the catalogue at call_tool", () => {
    const prompt = proxyCatalogPrompt(catalog);
    expect(prompt).toContain("`call_tool`");
    expect(prompt).toContain("fs__read");
    expect(proxyCatalogPrompt([])).toBe("");
  });

  it("answers a load with each new tool's whole definition", () => {
    const resolved = expandNames(["fs__read"], catalog);
    const result = proxyLoadResult(resolved, catalog, [definition("fs__read")], new Set());
    expect(result).toContain('"name":"fs__read"');
    expect(result).toContain('"parameters":{"type":"object"');
    expect(result).not.toContain("Not in the catalogue");
  });

  it("answers a repeat without the definition, and passes on the refusals", () => {
    const resolved = expandNames(["fs__read", "fs__nope"], catalog);
    const result = proxyLoadResult(
      resolved,
      catalog,
      [definition("fs__read")],
      new Set(["fs__read"]),
    );
    expect(result).not.toContain('"parameters"');
    expect(result).toContain("Already loaded earlier in this turn: fs__read");
    expect(result).toContain("Not in the catalogue: fs__nope");
  });

  it("reads a call's arguments as an object or as a JSON string", () => {
    const input = { path: "a.txt" };
    expect(proxiedCall({ name: "fs__read", arguments: input }, catalog)).toEqual({
      name: "fs__read",
      input,
    });
    expect(proxiedCall({ name: "fs__read", arguments: '{"path":"a.txt"}' }, catalog).input).toEqual(
      input,
    );
    expect(proxiedCall({ name: "fs__read" }, catalog).input).toEqual({});
  });

  it("refuses a call it cannot run", () => {
    expect(() => proxiedCall({}, catalog)).toThrow(/needs a name/);
    expect(() => proxiedCall({ name: "fs__nope", arguments: {} }, catalog)).toThrow(
      /Not in the catalogue/,
    );
    expect(() => proxiedCall({ name: "fs__read", arguments: "{" }, catalog)).toThrow(/valid JSON/);
    expect(() => proxiedCall({ name: "fs__read", arguments: [1] }, catalog)).toThrow(/an object/);
  });

  it("shows a call_tool as the tool it ran", () => {
    expect(
      shownCall(CALL_TOOL, JSON.stringify({ name: "fs__read", arguments: { path: "a.txt" } })),
    ).toEqual({ name: "fs__read", input: '{"path":"a.txt"}' });
    expect(shownCall("fs__read", "{}")).toEqual({ name: "fs__read", input: "{}" });
    expect(shownCall(CALL_TOOL, "{")).toEqual({ name: CALL_TOOL, input: "{" });
  });
});
