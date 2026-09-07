import { McpPool } from "@cubicecho/agent-mcp-pool";
import type { McpServerConfig, McpServerState } from "../shared/types.ts";

/**
 * min-agent's MCP servers, as `@cubicecho/agent-mcp-pool` holds them.
 *
 * The pool is the shared thing — connecting, reconnecting, qualifying tool names, running a
 * call — and this is the half that is min-agent's own: a server here is identified by the id
 * the user typed, and the screens read a server's whole config back beside its status.
 *
 * min-agent has never had a slug column: its ids are already slug-shaped
 * (`^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$`) and the MCP tab says so — "a server's id is the namespace
 * its tools live under". Since 0.6.0 the pool defaults `slug` to `id`, so the rows go in as they
 * are stored.
 */

const pool = new McpPool({ clientName: "min-agent" });

/** Reconcile live clients with the stored rows. Called on boot and on every edit. */
export async function sync(list: McpServerConfig[]) {
  await pool.sync(list);
}

/** Tears one server's connection down and dials it again. */
export async function reconnect(id: string, list: McpServerConfig[]) {
  await pool.reconnect(id, list);
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
 * Since 0.7.0 the pool reports the row it was configured from, in the order it was given them,
 * so the MCP tab lists the servers in the order they were saved in and a row that has not been
 * dialled yet still has somewhere to draw its form — without a second copy of the rows here to
 * go stale.
 *
 * The config is narrowed on the way back out: the pool's row type widens `args`, `env` and
 * `headers` to `| null` for consumers whose columns are nullable, and min-agent's zod schema
 * defaults all three. What comes back is the row this module passed in, so the narrower type is
 * the true one.
 */
export function state(): McpServerState[] {
  return pool.state().map((server) => ({
    config: server.config as McpServerConfig,
    status: server.status,
    error: server.error || undefined,
    tools: server.tools,
  }));
}
