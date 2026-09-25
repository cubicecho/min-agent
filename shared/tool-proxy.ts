/**
 * The one tool a proxied session runs every catalogued tool through. Shared because the client
 * unwraps it for display as well as the server dispatching it — see `server/tool-proxy.ts`.
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
  if (name !== CALL_TOOL) return { name, input };
  try {
    const args = JSON.parse(input) as { name?: unknown; arguments?: unknown };
    if (typeof args.name !== "string" || !args.name) return { name, input };
    const inner = args.arguments ?? {};
    return { name: args.name, input: typeof inner === "string" ? inner : JSON.stringify(inner) };
  } catch {
    return { name, input };
  }
}
