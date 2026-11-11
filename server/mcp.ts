import {
  type HookContext,
  type HookEvent,
  McpPool,
  type McpPoolOptions,
  type RunHooksOptions,
  type ServerLogEntry,
  serversWith,
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

/** A server's id and the name it is shown under. */
const idAndLabel = ({ id, label }: { id: string; label: string }) => ({ id, label });

/**
 * Builds the app's MCP servers: one pool, and min-agent's view of it. `server/index.ts` builds the
 * one the process runs on and hands it to whatever talks to the servers.
 *
 * @param options - Pool options laid over min-agent's own. For tests, which reach in-process
 *   servers through `createTransport` rather than spawning one.
 * @returns The servers, as the rest of the server reaches them.
 */
export function createMcp(options: McpPoolOptions = {}) {
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
   *
   * `callTimeoutMs` since pool 3.0, which is the first version that bounds a tool call at all; before
   * it every call took the SDK's 60s. That number was wrong in both directions. A search or a build
   * that legitimately runs past a minute was cut off, and a wedged tool still held the turn for the
   * whole minute with nothing the reader could do. The second half is now the turn's signal's job —
   * stopping a turn abandons its calls — so what is left for the timeout is a tool that wedges while
   * nobody is watching, and two minutes is generous to real work without leaving a turn hung for good.
   * It is not reset by progress notifications: a server that keeps talking is still cut off.
   *
   * `logLevel` is what a server that declares `logging` is asked to send, and warning is the floor
   * because a warning is what the chat shows: a tool card is read by a person looking for why a
   * call went the way it did, and a server left at its own default can say a hundred `debug` lines
   * during one search. A server that ignores the level is shown what it sends anyway.
   */
  const pool = new McpPool({
    clientName: "min-agent",
    clientVersion: VERSION,
    connectTimeoutMs: 15_000,
    callTimeoutMs: 120_000,
    logLevel: "warning",
    ...options,
  });

  /** The name a server is shown under, by its id; the id itself for one that has none. */
  const labelOf = (id: string) =>
    pool.state().find((server) => server.config.id === id)?.config.label || id;

  return {
    /**
     * Reconcile live clients with the stored rows. Called on boot and on every edit.
     *
     * `list` is required here, and both of these pass the pool's own optional parameter through as
     * non-optional on purpose: min-agent owns the rows, so the pool is built with no `load` to fall
     * back on, and since 2.4.1 a reconcile with neither is a `no-configs` refusal rather than an
     * empty set that closes every server. Keeping the argument mandatory means that refusal is a
     * type error here instead of a rejected promise in a resolver.
     */
    async sync(list: McpServerConfig[]) {
      await pool.sync(list);
    },

    /** Tears one server's connection down and dials it again. */
    async reconnect(id: string, list: McpServerConfig[]) {
      await pool.reconnect(id, list);
    },

    /**
     * Tool definitions for the model. Pass `names` to get only those — on-demand loading sends a
     * handful of schemas instead of every one.
     *
     * Named rather than positional since 2.0: the pool also takes a `servers` scope there, and both
     * are collections of strings, so a swap would have compiled and quietly offered no tools.
     */
    tools: (names?: string[]) => pool.tools({ names }),

    /**
     * Names and descriptions only — what the model browses before loading anything.
     *
     * Each server also carries the `instructions` its `initialize` answered with (pool 3.11), which
     * agent-core's `serverInstructions` writes into the system prompt. Servers use that text for
     * what a tool description has no room for — which tool to call first, what its ids look like —
     * and a model without it learns the same rule by making the call and reading the error.
     */
    catalog: () => pool.catalog(),

    /**
     * Whether a call to this tool only reads, which is what lets it run beside the step's other
     * reads. Anything else — a write, a tool its server does not annotate, a server whose row has
     * `trustAnnotations` off, a name nothing offers — answers false, and the turn runs that call
     * alone, after everything asked before it and before everything asked after.
     *
     * No `servers` scope: min-agent does not scope runs, so every enabled server's tools are the
     * turn's. Synchronous and off the pool's index, so it is asked once per call without a round
     * trip.
     */
    readsOnly: (qualifiedName: string) => pool.readsOnly(qualifiedName),

    /**
     * The connected servers that declared `resources`, in configuration order — via the pool's
     * `serversWith`. Whether `list_resources` and `read_resource` are declared at all, and the
     * servers a read tries in turn for a uri no listing named.
     */
    resourceServers: () => serversWith(pool.state(), "resources").map(idAndLabel),

    labelOf,

    /*
     * The rest of the protocol, as the pool reads it. Each listing is read to its last page — a
     * single `listResources()` here once showed a model only the first page of a server that
     * paginates — and only servers whose handshake declared the capability are asked, so a server
     * without prompts is not an error per listing.
     */
    /** Every prompt, per server. A server that failed to list has an empty list and `error`. */
    prompts: () => pool.prompts(),
    /** One prompt expanded and flattened to one string, by the pool's `promptText`. */
    expandPrompt: (serverId: string, name: string, args: Record<string, string>) =>
      pool.expandPrompt(serverId, name, args),
    /** Every resource and resource template, per server, as `prompts()` lists them. */
    resources: () => pool.resources(),
    /** One resource read back as text. */
    readResource: (serverId: string, uri: string) => pool.readResource(serverId, uri),
    /**
     * What a server suggests for one argument of a prompt, given what is typed so far. `[]`, not
     * an error, from a server that cannot complete, so the picker can ask on every pause.
     */
    complete: (
      serverId: string,
      prompt: string,
      argument: { name: string; value: string },
      context: Record<string, string>,
    ) => pool.complete(serverId, { type: "ref/prompt", name: prompt }, argument, context),

    /**
     * Runs one tool call and returns text for a tool result.
     *
     * This is the model's door, so it never passes `hidden`: a row's `hiddenTools` are refused here
     * as tools that do not exist, which is the whole of how they are kept from the model.
     *
     * `signal` is the turn's: a reader who stops the turn has no use for the answers it was waiting on,
     * and without it a slow tool kept running — and kept the turn's `finally` waiting — until it was done.
     *
     * `onLog` hears what the server logs while the call runs, which the turn passes on to the chat
     * as the call's own: agent-core's `report.log`, taken as it stands.
     */
    call: (
      qualifiedName: string,
      input: unknown,
      signal?: AbortSignal,
      onLog?: (entry: ServerLogEntry) => void,
    ) => pool.call(qualifiedName, input, { signal, ...(onLog ? { onLog } : {}) }),

    /**
     * Runs every enabled server's hooks for one event. Never rejects; see `server/hooks.ts`, which
     * is the only caller.
     */
    runHooks: (event: HookEvent, context: HookContext, options?: RunHooksOptions) =>
      pool.runHooks(event, context, options),

    /**
     * Closes every connection, for a process on its way out.
     *
     * `pool.shutdown()` rather than reconciling against an empty list: it also drops a debounced
     * reconcile that would otherwise fire into a closing pool, and it says what it is for.
     */
    shutdown: () => pool.shutdown(),

    /**
     * Every configured server, with its live connection state and tools.
     *
     * Since 0.7.0 the pool reports the row it was configured from, in the order it was given them,
     * so the MCP tab lists the servers in the order they were saved in and a row that has not been
     * dialled yet still has somewhere to draw its form — without a second copy of the rows here to
     * go stale.
     *
     * The config is narrowed on the way back out. Since 3.0 the pool's row is a union of a stdio arm
     * and an http arm, each widening its fields (`args` and `env`, or `headers`) to `| null` for
     * consumers whose columns are nullable. min-agent's row is one flat shape carrying both arms'
     * fields, which its zod schema defaults. What comes back is the row this module passed in, so the
     * narrower type is the true one.
     *
     * `secrets` because the MCP tab is an edit form: it opens on the row this returns and saves the
     * row back, so a redacted `env` would not read as "not shown" but be written over the key that
     * was there. 2.0 made withholding them the default, and the case it defends against — a config
     * sent to a browser — is one min-agent has always been in, since `McpServerConfig` carries both
     * fields across GraphQL. Worth revisiting as its own change; it is not one to make by taking a
     * new default silently.
     */
    state(): McpServerState[] {
      return pool.state({ secrets: true }).map((server) => ({
        config: server.config as McpServerConfig,
        status: server.status,
        error: server.error || undefined,
        tools: server.tools,
      }));
    },
  };
}

/** The app's MCP servers. */
export type Mcp = ReturnType<typeof createMcp>;
