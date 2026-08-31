import { describe, expect, it } from "vitest";
import type { CatalogServer } from "../server/mcp.ts";
import {
  catalogPrompt,
  expandNames,
  inCatalog,
  loadResult,
  requestedNames,
} from "../server/tool-loading.ts";

const catalog: CatalogServer[] = [
  {
    id: "router",
    label: "Router",
    tools: [
      { name: "router__fs__read_file", description: "Read a file." },
      { name: "router__fs__write_file", description: "Write a file." },
      { name: "router__web__search", description: "Search the web." },
    ],
  },
];

describe("catalogPrompt", () => {
  it("lists names without their descriptions", () => {
    const prompt = catalogPrompt(catalog);
    expect(prompt).toContain("router__fs__read_file");
    expect(prompt).not.toContain("Read a file.");
  });

  it("is empty when nothing is connected", () => {
    expect(catalogPrompt([])).toBe("");
  });
});

describe("expandNames", () => {
  it("matches exact names", () => {
    expect(expandNames(["router__web__search"], catalog)).toEqual({
      matched: ["router__web__search"],
      unknown: [],
    });
  });

  it("expands a trailing wildcard to a group", () => {
    expect(expandNames(["router__fs__*"], catalog).matched).toEqual([
      "router__fs__read_file",
      "router__fs__write_file",
    ]);
  });

  it("reports names it could not place, and never duplicates a match", () => {
    const { matched, unknown } = expandNames(
      ["router__fs__read_file", "router__fs__*", "nope"],
      catalog,
    );
    expect(matched).toHaveLength(2);
    expect(unknown).toEqual(["nope"]);
  });
});

describe("loadResult", () => {
  it("hands back the descriptions of what it loaded", () => {
    const text = loadResult(["router__web__search"], [], catalog);
    expect(text).toContain("Loaded 1 tool(s)");
    expect(text).toContain("Search the web.");
  });

  it("says so when a name was not found", () => {
    expect(loadResult([], ["nope"], catalog)).toContain("Not in the catalogue: nope");
  });
});

describe("requestedNames", () => {
  it("takes the documented shape, and the shapes models actually send", () => {
    expect(requestedNames({ names: ["a", "b"] })).toEqual(["a", "b"]);
    expect(requestedNames({ names: "a" })).toEqual(["a"]);
    expect(requestedNames({ tools: ["a"] })).toEqual(["a"]);
    expect(requestedNames({ names: [1, "a"] })).toEqual(["a"]);
    expect(requestedNames({})).toEqual([]);
  });
});

describe("inCatalog", () => {
  it("recognises a tool the model called without loading it", () => {
    expect(inCatalog(catalog, "router__web__search")).toBe(true);
    expect(inCatalog(catalog, "router__web__browse")).toBe(false);
  });
});
