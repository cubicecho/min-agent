import { McpPool } from "@cubicecho/agent-mcp-pool";
import type { McpServerConfig, McpServerState } from "../shared/types.ts";

/**
 * min-agent's MCP servers, as `@cubicecho/agent-mcp-pool` holds them.
 *
 * The pool is the shared thing — connecting, reconnecting, qualifying tool names, running a
 * call — and this is the half that is min-agent's own: a server here is identified by the id
 * the user typed, and the screens read a server's whole config back beside its status.
 */

/**
 * The pool namespaces tools by a `slug` alongside the id. min-agent has never had one: its ids
 * are already slug-shaped (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$`) and the MCP tab says so — "a
 * server's id is the namespace its tools live under". So the id is the slug, mapped here rather
 * than added to the schema, which would put a second name on the screen with nothing to say.
 */
const pooled = (config: McpServerConfig) => ({ ...config, slug: config.id });

const pool = new McpPool({ clientName: "min-agent" });

/**
 * The configs behind the live connections, kept so `state()` can hand a whole server back.
 *
 * The pool reports the identity and the status of what it is connected to, not the command
 * that started it — but the MCP tab draws the edit form and the connection state as one row,
 * so the two are rejoined here.
 */
let configs = new Map<string, McpServerConfig>();

const remember = (list: McpServerConfig[]) => {
  configs = new Map(list.map((config) => [config.id, config]));
};

/** Reconcile live clients with the stored rows. Called on boot and on every edit. */
export async function sync(list: McpServerConfig[]) {
  remember(list);
  await pool.sync(list.map(pooled));
}

/** Tears one server's connection down and dials it again. */
export async function reconnect(id: string, list: McpServerConfig[]) {
  remember(list);
  await pool.reconnect(id, list.map(pooled));
}

/**
 * Tool definitions for the model. Pass `names` to get only those — on-demand loading sends a
 * handful of schemas instead of every one.
 */
export const tools = (names?: string[]) => pool.tools(names);

/** Names and descriptions only — what the model browses before loading anything. */
export const catalog = () => pool.catalog();

/** Runs one tool call and returns text for a tool result. */
export const call = (qualifiedName: string, input: unknown) => pool.call(qualifiedName, input);

/**
 * Every configured server, with its live connection state and tools.
 *
 * Driven by the stored rows rather than by what the pool reports, so the MCP tab lists the
 * servers in the order they were saved in and a row that has not been dialled yet still has
 * somewhere to draw its form.
 */
export function state(): McpServerState[] {
  const live = new Map(pool.state().map((server) => [server.id, server]));
  return [...configs.values()].map((config) => {
    const server = live.get(config.id);
    return {
      config,
      status: server?.status ?? "connecting",
      error: server?.error || undefined,
      tools: server?.tools ?? [],
    };
  });
}
