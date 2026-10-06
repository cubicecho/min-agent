import {
  type CatalogServer,
  PROXY_TOOLS as CORE_PROXY_TOOLS,
  type expandNames,
  loadResult,
} from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";

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

/**
 * The parts of this that agent-core has had since 2.20.0, taken from it: the two declared tools,
 * the catalogue block worded for `call_tool`, the test for a load result that carries
 * definitions (which `server/pruning.ts` asks before clearing one), and the unwrapping of a
 * `call_tool`. Each was compared with the copy that used to live here and is the same text.
 */
export { holdsDefinitions, proxiedCall, proxyCatalogPrompt } from "@cubicecho/agent-core";

/**
 * `load_tools` and `call_tool`, as agent-core declares them. It types the array as read-only and
 * as the SDK's wider tool union; here it is read as the pool's function tools, which is what both
 * entries are, so it can sit in a tool array beside the pool's own. Frozen all the way down, so
 * the mutable type is a promise nobody can break.
 */
export const PROXY_TOOLS = CORE_PROXY_TOOLS as ToolDefinition[];

/**
 * What a proxied `load_tools` answers: each new tool's whole definition, since the result is the
 * only place the model will ever see it.
 *
 * Kept here rather than taken from agent-core, whose `proxyLoadResult` is not the same text: it
 * says "earlier in this conversation" where this says "earlier in this turn", and it adds a line
 * for a matched name it was given no definition for. Either would change what a stored tool row
 * holds.
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
  const fresh = definitions.filter((tool) => loaded.has(tool.function.name) === false);
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
    if (lines.length) {
      lines.push("");
    }
    lines.push(
      `Already loaded earlier in this turn: ${again.join(", ")}. Run them with \`call_tool\`; ` +
        "do not load them again.",
    );
  }
  // The refusals — too broad, over the per-call cap, not in the catalogue, nothing asked for —
  // are agent-core's, worded the same in both modes.
  const { overBroad, deferred, unknown, matched } = resolved;
  if (overBroad.length || deferred.length || unknown.length || !matched.length) {
    if (lines.length) {
      lines.push("");
    }
    lines.push(loadResult({ ...resolved, matched: [] }, catalog));
  }
  return lines.join("\n");
}
