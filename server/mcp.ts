import {
  type HookContext,
  type HookEvent,
  McpPool,
  type RunHooksOptions,
} from "@cubicecho/agent-mcp-pool";
import type { McpServerConfig, McpServerState } from "../shared/types.ts";
import { VERSION } from "./paths.ts";

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

/**
 * `connectTimeoutMs` because a reconcile is serialised and a wedged server holds the whole of
 * it: the SDK waits a minute for an `initialize` that is not coming, and Save on the MCP tab
 * waits with it — for every *other* server on the list as well, since the mutation answers with
 * the state once the reconcile is done. Fifteen seconds is longer than any healthy stdio server
 * takes to start and short enough that a broken one reads as broken rather than as a hung UI.
 *
 * Since pool 2.4.3 it is a budget for the whole connect rather than a ceiling on each request in
 * it. It bounded `initialize` and every page of `tools/list` separately before, so the number
 * multiplied by a page count only the server knows — a server that paginates its tools could
 * stall Save for a minute with 15s set, which is exactly the wait this line exists to prevent.
 *
 * `clientVersion` is the other half of what a dialled server is told about its caller, and new in
 * pool 2.3.0. Without it the handshake paired `min-agent` with the pool's own version — a number
 * that moves for reasons min-agent's users never see, under a name that says it is min-agent's.
 *
 * Since pool 2.4.0 a row can carry its own `connectTimeoutMs` and outrank this number, which is
 * the answer to the compromise above — a `uvx` server that downloads itself on first run wants two
 * minutes, and every other server on the list should not wait with it. min-agent does not offer it
 * yet: it would be a column, a GraphQL field and a form input, and the row here is deliberately
 * the small one (no `cwd`, no `idleTimeoutMs` either). Worth doing when a server that slow turns
 * up; until then 15s stands for all of them.
 */
const pool = new McpPool({
  clientName: "min-agent",
  clientVersion: VERSION,
  connectTimeoutMs: 15_000,
});

/**
 * Reconcile live clients with the stored rows. Called on boot and on every edit.
 *
 * `list` is required here, and both of these pass the pool's own optional parameter through as
 * non-optional on purpose: min-agent owns the rows, so the pool is built with no `load` to fall
 * back on, and since 2.4.1 a reconcile with neither is a `no-configs` refusal rather than an
 * empty set that closes every server. Keeping the argument mandatory means that refusal is a
 * type error here instead of a rejected promise in a resolver.
 */
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
 *
 * Named rather than positional since 2.0: the pool also takes a `servers` scope there, and both
 * are collections of strings, so a swap would have compiled and quietly offered no tools.
 */
export const tools = (names?: string[]) => pool.tools({ names });

/** Names and descriptions only — what the model browses before loading anything. */
export const catalog = () => pool.catalog();

/**
 * What each connected server said about itself when it connected, for the system prompt.
 *
 * `initialize` carries an `instructions` string, and servers use it for the things a tool
 * description has no room for — which tool to call first, what its ids look like, which of two
 * overlapping tools is the cheap one. Dropping it is why a model reaches for the right server and
 * still uses it wrongly: it learns the same rule by making the call, reading the error and trying
 * again, at a round trip a lesson and nothing carried into the next turn.
 *
 * Synchronous since pool 2.5.0 reports it on `state()` (cubicecho/agent-mcp-pool#70). It went
 * through `pool.client()` before, which is the call path's own door and dials a server sitting at
 * `idle` — safe here only because this pool is built neither `lazy` nor with an `idleTimeoutMs`,
 * which is a long way to reach for a string the handshake had already returned.
 */
export const instructions = () =>
  pool
    .state()
    .flatMap(({ label, instructions: text }) =>
      text?.trim() ? [{ label, text: text.trim() }] : [],
    );

/**
 * The connected servers that declared a given capability, in configuration order.
 *
 * `capabilities` is what the server said in the handshake, reported on `state()` since pool
 * 2.5.0. Asking a server that never claimed the capability is an error round trip per server per
 * surface, and — worse for a model — an error it has to read and discount before it can
 * conclude anything about what is actually available.
 */
const serversOffering = (capability: "resources" | "prompts") =>
  pool
    .state()
    .filter((server) => server.status === "ready" && server.capabilities?.[capability])
    .map(({ id, label }) => ({ id, label }));

/** The servers whose resources `list_resources` and `read_resource` reach. */
export const resourceServers = () => serversOffering("resources");

/** The servers whose prompts the composer's picker offers. */
export const promptServers = () => serversOffering("prompts");

/**
 * The connected MCP client for one server.
 *
 * The pool's own last mile is shaped for a tool call, and `resources/read` and `prompts/get` are
 * not one; this is the door it documents for the rest of the protocol. It bypasses the scope
 * check `call()` makes, which is a guard against a model reaching a server the run was not scoped
 * to — min-agent does not scope runs, so there is nothing here for it to bypass.
 */
export const client = (id: string) => pool.client(id);

/**
 * Runs one tool call and returns text for a tool result.
 *
 * This is the model's door, so it never passes `hidden`: a row's `hiddenTools` are refused here
 * as tools that do not exist, which is the whole of how they are kept from the model.
 */
export const call = (qualifiedName: string, input: unknown) => pool.call(qualifiedName, input);

/**
 * Runs every enabled server's hooks for one event. Never rejects; see `server/hooks.ts`, which
 * is the only caller.
 */
export const runHooks = (event: HookEvent, context: HookContext, options?: RunHooksOptions) =>
  pool.runHooks(event, context, options);

/**
 * Closes every connection, for a process on its way out.
 *
 * `pool.shutdown()` rather than reconciling against an empty list: it also drops a debounced
 * reconcile that would otherwise fire into a closing pool, and it says what it is for.
 */
export const shutdown = () => pool.shutdown();

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
 *
 * `secrets` because the MCP tab is an edit form: it opens on the row this returns and saves the
 * row back, so a redacted `env` would not read as "not shown" but be written over the key that
 * was there. 2.0 made withholding them the default, and the case it defends against — a config
 * sent to a browser — is one min-agent has always been in, since `McpServerConfig` carries both
 * fields across GraphQL. Worth revisiting as its own change; it is not one to make by taking a
 * new default silently.
 */
export function state(): McpServerState[] {
  return pool.state({ secrets: true }).map((server) => ({
    config: server.config as McpServerConfig,
    status: server.status,
    error: server.error || undefined,
    tools: server.tools,
  }));
}
