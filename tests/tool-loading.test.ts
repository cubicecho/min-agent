import { describe, expect, it } from "vitest";
import type { CatalogServer } from "../server/mcp.ts";
import {
  carryOver,
  catalogPrompt,
  expandNames,
  inCatalog,
  loadResult,
  MAX_CARRIED,
  MAX_PER_LOAD,
  preselectInput,
  preselection,
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

  it("marks loaded tools in place, without moving or dropping them", () => {
    const prompt = catalogPrompt(catalog, new Set(["router__fs__read_file"]));
    expect(prompt).toContain("router__fs__read_file (loaded)");
    expect(prompt).toContain("router__fs__write_file\n");
    expect(prompt).not.toContain("router__fs__write_file (loaded)");
    const names = catalog[0].tools.map((tool) => tool.name);
    const positions = names.map((name) => prompt.indexOf(name));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});

const wide: CatalogServer[] = [
  {
    id: "router",
    label: "Router",
    tools: Array.from({ length: MAX_PER_LOAD + 5 }, (_, i) => ({
      name: `router__mail__tool_${i}`,
      description: `Tool ${i}.`,
    })),
  },
];

describe("expandNames", () => {
  it("matches exact names", () => {
    expect(expandNames(["router__web__search"], catalog)).toMatchObject({
      matched: ["router__web__search"],
      unknown: [],
      overBroad: [],
    });
  });

  it("resolves a name the model gave without its server prefix", () => {
    expect(expandNames(["web__search"], catalog).matched).toEqual(["router__web__search"]);
    expect(expandNames(["fs__*"], catalog).matched).toEqual([
      "router__fs__read_file",
      "router__fs__write_file",
    ]);
  });

  it("refuses an unqualified name that matches more than one tool", () => {
    const two: CatalogServer[] = [
      { id: "a", label: "A", tools: [{ name: "a__fs__read_file", description: "" }] },
      { id: "b", label: "B", tools: [{ name: "b__fs__read_file", description: "" }] },
    ];
    expect(expandNames(["read_file"], two)).toMatchObject({ matched: [], unknown: ["read_file"] });
  });

  it("refuses a wildcard wider than one call may load", () => {
    const { matched, overBroad } = expandNames(["router__mail__*"], wide);
    expect(matched).toEqual([]);
    expect(overBroad[0].hits).toHaveLength(MAX_PER_LOAD + 5);
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
    const text = loadResult(
      { matched: ["router__web__search"], unknown: [], overBroad: [] },
      catalog,
    );
    expect(text).toContain("Loaded 1 tool(s)");
    expect(text).toContain("Search the web.");
  });

  it("says so when a name was not found", () => {
    expect(loadResult({ matched: [], unknown: ["nope"], overBroad: [] }, catalog)).toContain(
      "Not in the catalogue: nope",
    );
  });

  it("lists the candidates when a wildcard was too wide", () => {
    const text = loadResult(expandNames(["router__mail__*"], wide), wide);
    expect(text).toContain(`more than the ${MAX_PER_LOAD} one call may load`);
    expect(text).toContain("router__mail__tool_3");
  });
});

describe("carryOver", () => {
  it("keeps only what was used, most recent last", () => {
    expect(carryOver(["a", "b"], new Set(["b", "c"]))).toEqual(["a", "b", "c"]);
  });

  it("drops the least recently used past the cap", () => {
    const previous = Array.from({ length: MAX_CARRIED }, (_, i) => `old_${i}`);
    const out = carryOver(previous, new Set(["fresh"]));
    expect(out).toHaveLength(MAX_CARRIED);
    expect(out.at(-1)).toBe("fresh");
    expect(out).not.toContain("old_0");
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

describe("preselection", () => {
  it("resolves names the way load_tools does, bare names included", () => {
    expect(preselection(["router__fs__read_file", "search"], catalog)).toEqual([
      "router__fs__read_file",
      "router__web__search",
    ]);
  });

  it("drops names that are not in the catalogue rather than failing", () => {
    expect(preselection(["router__fs__read_file", "not_a_tool"], catalog)).toEqual([
      "router__fs__read_file",
    ]);
  });

  it("returns nothing for a non-array, so a malformed reply just means no preselection", () => {
    expect(preselection(undefined, catalog)).toEqual([]);
    expect(preselection({ names: ["router__fs__read_file"] }, catalog)).toEqual([]);
    expect(preselection(["", 7, null], catalog)).toEqual([]);
  });

  it("caps a greedy selection at MAX_PER_LOAD", () => {
    const many: CatalogServer[] = [
      {
        id: "big",
        label: "Big",
        tools: Array.from({ length: MAX_PER_LOAD + 5 }, (_, i) => ({
          name: `big__tool_${i}`,
          description: "",
        })),
      },
    ];
    const asked = many[0].tools.map((tool) => tool.name);
    expect(preselection(asked, many)).toHaveLength(MAX_PER_LOAD);
  });

  it("shows the picker the names and the request, but not load_tools instructions", () => {
    const input = preselectInput(catalog, "read my notes file");
    expect(input).toContain("router__fs__read_file");
    expect(input).toContain("read my notes file");
    expect(input).not.toContain("load_tools");
  });
});
