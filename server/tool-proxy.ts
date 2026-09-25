import {
  type CatalogServer,
  catalogList,
  type expandNames,
  inCatalog,
  LOAD_TOOLS,
  loadResult,
} from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { CALL_TOOL } from "../shared/tool-proxy.ts";

/**
 * Proxied tool discovery: on-demand loading with a tool array that never changes.
 *
 * On-demand mode declares each tool as it is loaded, and a chat template renders the tool array
 * inside the system turn, ahead of the whole conversation. Appending one definition there moves
 * every token after it, so each load re-prefills the transcript — and on a hybrid model, which
 * llama.cpp can only rewind to a saved checkpoint, usually all of it from the first token. Here
 * the array is `load_tools` and `call_tool` for the life of the session: a load answers with the
 * definitions as its result, at the end of the history where the cache already stops, and the
 * model calls a loaded tool through `call_tool`. The price is one level of indirection the model
 * has to get right, which a small model does less reliably than a native call.
 */

/** Shallow freezing these would leave `.function.description` — the part worth editing. */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") for (const held of Object.values(value)) deepFreeze(held);
  return Object.freeze(value);
}

/**
 * `load_tools` and `call_tool`, frozen and shared for the same reason as `RESOURCE_TOOLS`. The
 * load keeps agent-core's name, so `requestedNames` and `expandNames` read its arguments as they
 * do in on-demand mode; only what it promises differs.
 */
export const PROXY_TOOLS: ToolDefinition[] = deepFreeze([
  {
    type: "function",
    function: {
      name: LOAD_TOOLS,
      description:
        "Get the full definitions of tools listed in the tool catalogue: what each does and the " +
        "arguments it takes. Pass the exact names you need, or a trailing wildcard like " +
        "`server__group__*` for a whole group. Then run them with `call_tool`. Load only what " +
        "the task actually needs.",
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
  },
  {
    type: "function",
    function: {
      name: CALL_TOOL,
      description:
        "Run a tool from the catalogue. Load it with `load_tools` first to learn its arguments, " +
        "then pass its exact name and an arguments object matching its parameters.",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "The tool's exact name from the catalogue." },
          arguments: {
            type: "object",
            description: "The tool's arguments, as its definition describes them.",
            // Any keys at all: without this a grammar-constrained server can compile the empty
            // property list into `{}` and leave the model no way to pass an argument.
            additionalProperties: true,
          },
        },
        required: ["name", "arguments"],
      },
    },
  },
]);

/**
 * The catalogue block for the system prompt, worded for `call_tool` rather than a tool list.
 *
 * @param catalog The connected servers. A catalogue with no tools in it produces an empty string.
 */
export function proxyCatalogPrompt(catalog: CatalogServer[]): string {
  const list = catalogList(catalog);
  if (!list) return "";
  return [
    "# Tool catalogue",
    "",
    "These tools exist. Call `load_tools` with the names you need to get their definitions, then",
    "run them with `call_tool`. Names are descriptive; load a tool to see its parameters. A tool",
    "whose definition is already in this conversation does not need loading again. Do not load",
    "tools the task does not need, and do not mention this mechanism in your answer.",
    "",
    list,
  ].join("\n");
}

/**
 * What a proxied `load_tools` answers: each new tool's whole definition, since the result is the
 * only place the model will ever see it.
 *
 * @param resolved What the call asked for, from `expandNames`.
 * @param definitions The definitions of `resolved.matched`, from the pool.
 * @param loaded Loaded before this call. These are answered with a pointer back rather than their
 * definition a second time.
 */
export function proxyLoadResult(
  resolved: ReturnType<typeof expandNames>,
  catalog: CatalogServer[],
  definitions: readonly ToolDefinition[],
  loaded: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  const fresh = definitions.filter((tool) => !loaded.has(tool.function.name));
  const again = resolved.matched.filter((name) => loaded.has(name));
  if (fresh.length) {
    lines.push(`Loaded ${fresh.length} tool(s). Run them with \`call_tool\`.`);
    for (const { function: tool } of fresh) {
      lines.push(
        "",
        JSON.stringify({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }),
      );
    }
  }
  if (again.length) {
    if (lines.length) lines.push("");
    lines.push(
      `Already loaded earlier in this turn: ${again.join(", ")}. Run them with \`call_tool\`; ` +
        "do not load them again.",
    );
  }
  // The refusals — too broad, over the per-call cap, not in the catalogue, nothing asked for —
  // are agent-core's, worded the same in both modes.
  const { overBroad, deferred, unknown, matched } = resolved;
  if (overBroad.length || deferred.length || unknown.length || !matched.length) {
    if (lines.length) lines.push("");
    lines.push(loadResult({ ...resolved, matched: [] }, catalog));
  }
  return lines.join("\n");
}

/**
 * The tool a `call_tool` names and the arguments to run it with.
 *
 * `arguments` arrives as an object when the model follows the schema and as a JSON string when
 * it copies the shape of a native call instead; both are taken, since the intent is the same.
 *
 * @param args The `call_tool` call's own arguments, parsed.
 * @param catalog What may be called. A name outside it is refused here, not by the pool.
 */
export function proxiedCall(
  args: Record<string, unknown>,
  catalog: CatalogServer[],
): { name: string; input: Record<string, unknown> } {
  const name = typeof args.name === "string" ? args.name.trim() : "";
  if (!name) throw new Error("call_tool needs a name; pass one from the tool catalogue.");
  if (!inCatalog(catalog, name))
    throw new Error(`Not in the catalogue: ${name}. Check the name and try again.`);
  let input: unknown = args.arguments ?? {};
  if (typeof input === "string") {
    const text = input;
    try {
      input = text.trim() ? JSON.parse(text) : {};
    } catch {
      throw new Error(`call_tool arguments for ${name} are not valid JSON: ${text.slice(0, 200)}`);
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error(`call_tool arguments for ${name} must be an object.`);
  return { name, input: input as Record<string, unknown> };
}
