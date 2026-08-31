import type OpenAI from "openai";
import type { CatalogServer } from "./mcp.ts";

/**
 * On-demand tool loading.
 *
 * A full tool definition is mostly JSON Schema, and it is sent on every request of every
 * turn whether or not the model wants it. So in "ondemand" mode the model starts with a
 * bare *catalogue* — tool names only, appended to the system prompt — plus this one
 * meta-tool. It calls `load_tools` with what it needs, and the next round trip in the same
 * turn carries those real definitions.
 *
 * Names alone cost roughly a fortieth of what the schemas cost, so a turn that needs no
 * tools pays almost nothing, and a turn that needs three pays for three.
 */
export const LOAD_TOOLS = "load_tools";

export function loadToolsDefinition(): OpenAI.ChatCompletionTool {
  return {
    type: "function",
    function: {
      name: LOAD_TOOLS,
      description:
        "Load the full definitions of tools listed in the tool catalogue so you can call them. " +
        "Pass the exact names you need, or a trailing wildcard like `server__group__*` for a " +
        "whole group. The tools become callable on your next step — load them, then call them. " +
        "Load only what the task actually needs.",
      parameters: {
        type: "object",
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Tool names from the catalogue. Wildcards may end with `*`.",
          },
        },
        required: ["names"],
        additionalProperties: false,
      },
    },
  };
}

/** The catalogue block appended to the system prompt. Names only — descriptions arrive on load. */
export function catalogPrompt(catalog: CatalogServer[]): string {
  if (!catalog.length) return "";
  const groups = catalog.map(
    (server) => `${server.label}:\n${server.tools.map((tool) => `  ${tool.name}`).join("\n")}`,
  );
  return [
    "# Tool catalogue",
    "",
    "These tools exist but are not loaded. Call `load_tools` with the names you need, then call",
    "them on the step after. Names are descriptive; load a tool to see its parameters. Do not",
    "load tools the task does not need, and do not mention this mechanism to the user.",
    "",
    ...groups,
  ].join("\n");
}

const flatten = (catalog: CatalogServer[]) => catalog.flatMap((server) => server.tools);

/** Resolves requested names against the catalogue, expanding trailing `*` wildcards. */
export function expandNames(requested: string[], catalog: CatalogServer[]) {
  const all = flatten(catalog);
  const matched = new Set<string>();
  const unknown: string[] = [];

  for (const raw of requested) {
    const name = raw.trim();
    if (!name) continue;
    const hits = name.endsWith("*")
      ? all.filter((tool) => tool.name.startsWith(name.slice(0, -1)))
      : all.filter((tool) => tool.name === name);
    if (!hits.length) unknown.push(name);
    for (const hit of hits) matched.add(hit.name);
  }

  return { matched: [...matched], unknown };
}

/** What `load_tools` reports back: the descriptions, now that they are worth their tokens. */
export function loadResult(matched: string[], unknown: string[], catalog: CatalogServer[]): string {
  const byName = new Map(flatten(catalog).map((tool) => [tool.name, tool.description]));
  const lines: string[] = [];

  if (matched.length) {
    lines.push(`Loaded ${matched.length} tool(s); they are callable on your next step.`, "");
    for (const name of matched) lines.push(`${name}: ${byName.get(name) ?? ""}`.trim());
  }
  if (unknown.length) {
    if (lines.length) lines.push("");
    lines.push(`Not in the catalogue: ${unknown.join(", ")}. Check the names and try again.`);
  }
  return lines.join("\n") || "No tool names were given.";
}

export const inCatalog = (catalog: CatalogServer[], name: string) =>
  flatten(catalog).some((tool) => tool.name === name);

/** `load_tools` arguments, defensively — a model may send a bare string or a nested object. */
export function requestedNames(args: Record<string, unknown>): string[] {
  const value = args.names ?? args.tools ?? args.name;
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  return [];
}
