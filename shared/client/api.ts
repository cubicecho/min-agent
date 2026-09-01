import {
  ConfigDocument,
  CreateSessionDocument,
  DeleteSessionDocument,
  type McpServerInput,
  type McpStateFragment,
  McpStatusDocument,
  ModelsDocument,
  ReconnectMcpServerDocument,
  RenameSessionDocument,
  SaveConfigDocument,
  SaveMcpServersDocument,
  SessionDetailDocument,
  type SessionDetailQuery,
  type SessionSummaryFragment,
  SessionsDocument,
  SetApiKeyDocument,
  TurnDocument,
  type UpdateSettingInput,
} from "../gql/graphql.ts";
import { toStored } from "../messages.ts";
import type {
  Compaction,
  LlmConfig,
  LlmConfigView,
  McpServerConfig,
  McpServerState,
  ModelInfo,
  Session,
  SessionSummary,
  StreamEvent,
  TokenUsage,
  ToolCall,
  TurnStats,
} from "../types.ts";
import { createGqlClient } from "./gql.ts";

/**
 * The API the app calls.
 *
 * Underneath it is GraphQL, but the shape is deliberately the small set of verbs the UI
 * actually has — nine reads and writes and one stream — rather than a query builder. The
 * columns that are `JSON` on the wire (`usage`, `compaction`, `stats`, ...) are cast back to
 * their types here, in one place, so no component has to know they arrived as `unknown`.
 */

/** `fetch` is injected because React Native's built-in one cannot stream: Expo passes `expo/fetch`. */
export interface ClientOptions {
  /**
   * The GraphQL endpoint — `"/graphql"` in the browser, an absolute
   * `"http://host:8787/graphql"` on a device. A function is re-read on every call, so a
   * client built once still follows a server address the user edits later.
   */
  baseUrl: string | (() => string);
  fetch?: typeof globalThis.fetch;
}

export interface TurnOptions {
  sessionId: string;
  prompt: string;
  model?: string;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

const summary = (row: SessionSummaryFragment): SessionSummary => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  model: row.model,
  usage: (row.usage as TokenUsage | null) ?? undefined,
  loadedTools: (row.loadedTools as string[] | null) ?? undefined,
  compaction: (row.compaction as Compaction | null) ?? undefined,
  messageCount: row.messageCount,
});

/** A summary is a session without its transcript, which is all a freshly created one has. */
const asSession = (row: SessionSummaryFragment): Session => ({ ...summary(row), messages: [] });

const detail = (row: NonNullable<SessionDetailQuery["session"]>): Session => ({
  ...summary(row),
  messages: row.messages.map((message) =>
    toStored({
      role: message.role,
      content: message.content ?? null,
      reasoningContent: message.reasoningContent,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls as ToolCall[] | null,
      stats: message.stats as TurnStats | null,
      followups: message.followups as string[] | null,
    }),
  ),
});

const mcpState = (state: McpStateFragment): McpServerState => ({
  config: state.config as McpServerConfig,
  status: state.status as McpServerState["status"],
  error: state.error ?? undefined,
  tools: state.tools,
});

/** The GraphQL enum is a string on both sides; only the TypeScript spelling differs. */
const settingsInput = (patch: Partial<LlmConfig>): UpdateSettingInput =>
  patch as unknown as UpdateSettingInput;

export function createClient({ baseUrl, fetch: fetchImpl }: ClientOptions) {
  const { request, subscribe } = createGqlClient({ endpoint: baseUrl, fetch: fetchImpl });

  async function config(): Promise<LlmConfigView> {
    const { setting, hasApiKey } = await request(ConfigDocument);
    // The row cannot be missing — the migration seeds it — so say that rather than quietly
    // handing the UI a settings object full of `undefined` on the day it is.
    if (!setting) throw new Error("no settings row");

    // Deliberately not re-validated. Every one of these columns is non-null in the schema and
    // the query names them one at a time, so a field this client asks for either arrives
    // typed or the whole request fails — there is no partial answer for a parse to repair.
    // The two casts are the JSON scalars, which GraphQL cannot describe more precisely.
    return {
      ...setting,
      taskModels: setting.taskModels as LlmConfig["taskModels"],
      pricing: setting.pricing as LlmConfig["pricing"],
      hasApiKey,
    };
  }

  const api = {
    config,

    /**
     * The key is write-only and lives on its own mutation, so a save that leaves the field
     * blank keeps the stored one rather than blanking it.
     */
    async saveConfig(patch: Partial<LlmConfig>): Promise<LlmConfigView> {
      const { apiKey, ...columns } = patch;
      if (apiKey) await request(SetApiKeyDocument, { apiKey });
      if (Object.keys(columns).length) {
        await request(SaveConfigDocument, { set: settingsInput(columns) });
      }
      return config();
    },

    models: async () => ({ models: (await request(ModelsDocument)).models as ModelInfo[] }),

    sessions: async () => (await request(SessionsDocument)).sessions.map(summary),

    async session(id: string): Promise<Session> {
      const { session } = await request(SessionDetailDocument, { id });
      if (!session) throw new Error("session not found");
      return detail(session);
    },

    createSession: async () => asSession((await request(CreateSessionDocument)).createSession),

    async renameSession(id: string, title: string): Promise<Session> {
      const { updateSessionSingle } = await request(RenameSessionDocument, { id, title });
      if (!updateSessionSingle) throw new Error("session not found");
      return asSession(updateSessionSingle);
    },

    deleteSession: async (id: string) => {
      await request(DeleteSessionDocument, { id });
    },

    mcp: async () => (await request(McpStatusDocument)).mcpStatus.map(mcpState),

    saveMcp: async (servers: McpServerConfig[]) =>
      (
        await request(SaveMcpServersDocument, { servers: servers as McpServerInput[] })
      ).saveMcpServers.map(mcpState),

    reconnectMcp: async (id: string) =>
      (await request(ReconnectMcpServerDocument, { id })).reconnectMcpServer.map(mcpState),
  };

  /**
   * Runs a turn and hands each event to `onEvent` as it arrives.
   *
   * Subscribing is what starts the turn, and returning from this function — normally, or
   * because `signal` fired — is what stops it. One flat `TurnEvent` comes back off the wire,
   * because a union of nine shapes costs more in generated types and inline fragments than
   * a `type` field and a switch does here.
   */
  async function streamTurn({ sessionId, prompt, model, onEvent, signal }: TurnOptions) {
    for await (const { turn } of subscribe(TurnDocument, { sessionId, prompt, model }, signal)) {
      const { seq: _seq, ...rest } = turn;
      const event = Object.fromEntries(
        Object.entries(rest).filter(([, value]) => value !== null),
      ) as unknown as StreamEvent;
      onEvent(event);
    }
  }

  return { api, streamTurn };
}
