import { buildSchema, GraphQLDateTime } from "@vantreeseba/drizzle-graphql";
import { eq } from "drizzle-orm";
import {
  GraphQLBoolean,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLInt,
  GraphQLList,
  GraphQLNonNull,
  GraphQLObjectType,
  GraphQLSchema,
  GraphQLString,
} from "graphql";
import { GraphQLJSON } from "graphql-scalars";
import type { EmbedConfig, McpServerConfig } from "../../shared/types.ts";
import { listModels } from "../agent.ts";
import {
  assertLlmConfigPatch,
  loadLlmConfig,
  loadMcpServers,
  refreshLlmConfig,
  resolveApiKey,
  saveEmbeds,
  saveMcpServers,
} from "../config.ts";
import { db } from "../db/client.ts";
import { settings } from "../db/schema.ts";
import { mcp } from "../mcp.ts";
import { truncateSession } from "../store.ts";
import { runTurnEvents, type TurnArgs } from "../turns.ts";

/**
 * The CRUD half of the API is generated from the Drizzle schema — sessions, messages and the
 * settings row all get their queries, filters and mutations for free, and stay in step with the
 * tables by construction. Only what is not a row edit is written by hand below: listing the
 * models a server reports, the live state of the MCP connections, and running a turn.
 */
const { entities } = buildSchema(db, {
  // `sessions` → type `Session`, queries `sessions` (list) and `sessionsSingle`.
  typeNameMapper: "singularize",
  defaults: {
    // The sidebar is a most-recent-first list, and a transcript is only ever read in order.
    // Declared here once rather than by every client, and it reaches the `messages` relation
    // field too — a relation is ordered by the default of the table it reads.
    sessions: { orderBy: { updatedAt: "desc" } },
    messages: { orderBy: { idx: "asc" } },
    // The sidebar draws them in this order, and it reads the generated query directly.
    embeds: { orderBy: { position: "asc" } },
  },
  features: {
    // A message is written by the turn that produced it, and the MCP list is saved as a set
    // (see `saveMcpServers`) — a hand-made row in either would claim something that never
    // happened. The settings row is a singleton `ensureSchema` creates and nothing deletes.
    insert: (table) => table === "sessions",
    update: (table) => table === "sessions" || table === "settings",
    delete: (table) => table === "sessions",
  },
  exclude: {
    // The key never needs to travel back to the browser; the UI only ever writes it.
    columns: { settings: ["apiKey"] },
  },
  mapColumnType: (column) => (column.columnType === "PgTimestamp" ? GraphQLDateTime : undefined),
  onWrite: {
    // `loadLlmConfig()` is read synchronously all through a turn, so the copy it reads has to
    // be renewed by whatever wrote the row — including the generated mutation, which knows
    // nothing about the cache.
    settings: {
      // The generated input carries the column types and no range at all, so this is where
      // `llmConfigSchema`'s bounds are applied to a write. Throwing rolls the mutation back.
      before: ({ args }) => {
        assertLlmConfigPatch(args?.set);
      },
      after: async () => {
        await refreshLlmConfig();
      },
    },
  },
});

const McpToolType = new GraphQLObjectType({
  name: "McpTool",
  fields: {
    name: { type: new GraphQLNonNull(GraphQLString) },
    description: { type: new GraphQLNonNull(GraphQLString) },
  },
});

const McpTransportEnum = new GraphQLEnumType({
  name: "McpTransport",
  values: { stdio: { value: "stdio" }, http: { value: "http" } },
});

const McpServerConfigType = new GraphQLObjectType({
  name: "McpServerConfig",
  description: "A configured MCP server. `id` is the namespace its tools are exposed under.",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    label: { type: new GraphQLNonNull(GraphQLString) },
    enabled: { type: new GraphQLNonNull(GraphQLBoolean) },
    transport: { type: new GraphQLNonNull(McpTransportEnum) },
    command: { type: new GraphQLNonNull(GraphQLString) },
    args: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(GraphQLString))) },
    env: { type: new GraphQLNonNull(GraphQLJSON) },
    url: { type: new GraphQLNonNull(GraphQLString) },
    headers: { type: new GraphQLNonNull(GraphQLJSON) },
  },
});

const McpServerInput = new GraphQLInputObjectType({
  name: "McpServerInput",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    label: { type: GraphQLString },
    enabled: { type: GraphQLBoolean },
    transport: { type: McpTransportEnum },
    command: { type: GraphQLString },
    args: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    env: { type: GraphQLJSON },
    url: { type: GraphQLString },
    headers: { type: GraphQLJSON },
  },
});

/**
 * The generated object type for the `embeds` table, reused as what `saveEmbeds` hands back —
 * so a save and the `embeds` query return the same type and one fragment covers both.
 *
 * Read through a `Record` because `entities.types` is keyed by the *generated* type name,
 * which `typeNameMapper: "singularize"` makes `Embed`, while the declared type of that object
 * spells the key `Embeds`. Indexing it as declared compiles and is `undefined` at runtime.
 */
const EmbedType = (entities.types as unknown as Record<string, GraphQLObjectType>).Embed;

const embedList = new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(EmbedType)));

const EmbedModeEnum = new GraphQLEnumType({
  name: "EmbedMode",
  values: { iframe: { value: "iframe" }, external: { value: "external" } },
});

const EmbedInput = new GraphQLInputObjectType({
  name: "EmbedInput",
  description: "One row of the embed list. Reads come from the generated `embeds` query.",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    label: { type: GraphQLString },
    url: { type: GraphQLString },
    icon: { type: GraphQLString },
    mode: { type: EmbedModeEnum },
    enabled: { type: GraphQLBoolean },
  },
});

const McpServerStateType = new GraphQLObjectType({
  name: "McpServerState",
  description: "A configured server and what the connection to it is currently doing.",
  fields: {
    config: { type: new GraphQLNonNull(McpServerConfigType) },
    status: {
      type: new GraphQLNonNull(GraphQLString),
      description: "disabled | connecting | ready | error",
    },
    error: { type: GraphQLString },
    tools: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpToolType))) },
  },
});

const ModelInfoType = new GraphQLObjectType({
  name: "ModelInfo",
  fields: {
    id: { type: new GraphQLNonNull(GraphQLString) },
    contextLength: {
      type: GraphQLInt,
      description: "The model's window, when the server reports one. Null when it does not.",
    },
  },
});

const HealthType = new GraphQLObjectType({
  name: "Health",
  fields: {
    ok: { type: new GraphQLNonNull(GraphQLBoolean) },
    baseUrl: { type: new GraphQLNonNull(GraphQLString) },
    model: { type: new GraphQLNonNull(GraphQLString) },
    hasApiKey: { type: new GraphQLNonNull(GraphQLBoolean) },
  },
});

const TurnEventType = new GraphQLObjectType({
  name: "TurnEvent",
  description:
    "Something a turn did while it was running — a token, a tool call, its final cost. " +
    "`type` discriminates; the fields that do not belong to it are null.",
  fields: {
    seq: { type: new GraphQLNonNull(GraphQLInt), description: "Per-turn counter from 1." },
    type: {
      type: new GraphQLNonNull(GraphQLString),
      description:
        "reasoning_delta | text_delta | tool_use | tool_result | title | stats | done | " +
        "followups | error.",
    },
    text: { type: GraphQLString },
    id: { type: GraphQLString },
    name: { type: GraphQLString },
    input: { type: GraphQLString },
    toolUseId: { type: GraphQLString },
    content: { type: GraphQLString },
    isError: { type: GraphQLBoolean },
    title: { type: GraphQLString },
    stats: { type: GraphQLJSON },
    items: { type: new GraphQLList(new GraphQLNonNull(GraphQLString)) },
    message: { type: GraphQLString },
  },
});

const mcpList = new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpServerStateType)));

export const schema = new GraphQLSchema({
  query: new GraphQLObjectType({
    name: "Query",
    fields: {
      ...entities.queries,
      models: {
        type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(ModelInfoType))),
        description: "Models the configured OpenAI-compatible server reports, id-sorted.",
        resolve: () => listModels(),
      },
      mcpStatus: {
        type: mcpList,
        description: "Every configured MCP server, with its live connection state and tools.",
        resolve: () => mcp.state(),
      },
      health: {
        type: new GraphQLNonNull(HealthType),
        description: "Answers only once the settings are loaded and the schema is up.",
        resolve: () => {
          const config = loadLlmConfig();
          return {
            ok: true,
            baseUrl: config.baseUrl,
            model: config.model,
            hasApiKey: Boolean(resolveApiKey(config)),
          };
        },
      },
      hasApiKey: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Whether a key is set, without saying what it is. The Config tab shows a filled " +
          "placeholder rather than an empty box; the key itself is excluded from `Setting`.",
        resolve: () => Boolean(resolveApiKey()),
      },
    },
  }),
  mutation: new GraphQLObjectType({
    name: "Mutation",
    fields: {
      ...entities.mutations,
      setApiKey: {
        type: new GraphQLNonNull(GraphQLBoolean),
        description:
          "Writes the API key. Separate from the settings update because the key is " +
          "write-only: it is excluded from `Setting` so it can never be read back out. An " +
          "empty string clears it and falls back to $OPENAI_API_KEY.",
        args: { apiKey: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: async (_source, args: { apiKey: string }) => {
          await db.update(settings).set({ apiKey: args.apiKey }).where(eq(settings.id, "default"));
          await refreshLlmConfig();
          return true;
        },
      },
      saveMcpServers: {
        type: mcpList,
        description:
          "Replaces the configured set and reconnects. The list is edited and saved whole — a " +
          "server's id is the namespace its tools live under, so renaming one is a different " +
          "server, not an edited row.",
        args: {
          servers: {
            type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(McpServerInput))),
          },
        },
        resolve: async (_source, args: { servers: McpServerConfig[] }) => {
          const saved = await saveMcpServers(args.servers);
          await mcp.sync(saved);
          return mcp.state();
        },
      },
      reconnectMcpServer: {
        type: mcpList,
        description: "Tears down one server's connection and dials it again.",
        args: { id: { type: new GraphQLNonNull(GraphQLString) } },
        resolve: async (_source, args: { id: string }) => {
          await mcp.reconnect(args.id, await loadMcpServers());
          return mcp.state();
        },
      },
      truncateSession: {
        type: new GraphQLNonNull(GraphQLInt),
        description:
          "Forgets every message from `fromIdx` on, and answers with how many are left. The " +
          "only write that removes a message: retrying a reply and editing a question both " +
          "mean going again from a point, and what follows that point is an answer to " +
          "something no longer being asked. A suffix only, so `idx` stays dense.",
        args: {
          id: { type: new GraphQLNonNull(GraphQLString) },
          fromIdx: { type: new GraphQLNonNull(GraphQLInt) },
        },
        resolve: (_source, args: { id: string; fromIdx: number }) =>
          truncateSession(args.id, args.fromIdx),
      },
      saveEmbeds: {
        type: embedList,
        description:
          "Replaces the configured embeds. Saved whole rather than row by row: an embed's id " +
          "is the route its view lives at, so a rename is a new destination and the screen " +
          "edits the list as a list.",
        args: {
          embeds: { type: new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(EmbedInput))) },
        },
        resolve: (_source, args: { embeds: EmbedConfig[] }) => saveEmbeds(args.embeds),
      },
    },
  }),
  subscription: new GraphQLObjectType({
    name: "Subscription",
    fields: {
      turn: {
        type: new GraphQLNonNull(TurnEventType),
        description:
          "Runs one turn and streams what it says. Subscribing starts the turn; ending the " +
          "subscription stops it, keeping whatever it had already written.",
        args: {
          sessionId: { type: new GraphQLNonNull(GraphQLString) },
          prompt: { type: new GraphQLNonNull(GraphQLString) },
          model: {
            type: GraphQLString,
            description: "Overrides the session's model for this turn.",
          },
        },
        subscribe: (_source, args: TurnArgs) => runTurnEvents(args),
        resolve: (event: unknown) => event,
      },
    },
  }),
  types: [...Object.values(entities.types), ...Object.values(entities.inputs)],
});
