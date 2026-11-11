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
 *
 * The mode is agent-core's own, run by its loop; min-agent's resource tools sit beside the two as
 * the loop's host tools. What is here is the display's half, which the app needs and cannot take
 * from agent-core: Metro resolves packages from `mobile/node_modules` only.
 */

/**
 * The one tool a proxied session runs every catalogued tool through, as agent-core names it.
 * Shared because the client unwraps it for display as well as the server dispatching it.
 */
export const CALL_TOOL = "call_tool";

/**
 * A tool call as it should be shown: a `call_tool` as the tool it ran, anything else as it is.
 *
 * The transcript keeps the `call_tool` the model wrote, since the next request has to repeat it
 * word for word to stay in the cache; only the display looks through it. Anything that does not
 * parse as a proxied call is left as it came.
 *
 * @param name The name the model called.
 * @param input The call's raw arguments.
 */
export function shownCall(name: string, input: string): { name: string; input: string } {
  if (name !== CALL_TOOL) {
    return { name, input };
  }
  try {
    const args = JSON.parse(input) as { name?: unknown; arguments?: unknown };
    if (typeof args.name !== "string" || !args.name) {
      return { name, input };
    }
    const inner = args.arguments ?? {};
    return { name: args.name, input: typeof inner === "string" ? inner : JSON.stringify(inner) };
  } catch {
    return { name, input };
  }
}
