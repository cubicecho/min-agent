import { defineRelations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  real,
  snakeCase,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import type {
  Compaction,
  StoredMessage,
  TokenUsage,
  ToolCall,
  TurnStats,
} from "../../shared/types.ts";

/**
 * Everything min-agent keeps: its **settings**, the **MCP servers** it connects to, and the
 * **sessions** it has had, each a list of **messages**.
 *
 * Sessions and messages are two tables rather than one transcript blob because a turn only
 * ever *appends*. Stored as one value, every token of every turn rewrote the whole
 * conversation — seven times a turn, growing with the history each time. As rows, a turn
 * writes the messages it actually produced and nothing else.
 *
 * `snakeCase.table` is `pgTable` with a naming convention attached: a column declared as
 * `sessionId` is `session_id` in the database, so neither the TypeScript nor the SQL has to
 * be spelled in the other's idiom. In 1.0 that is a table-level choice rather than a
 * `drizzle()` option, which is why it appears here and not in `client.ts`.
 */

const { table } = snakeCase;

const id = () =>
  text()
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());

const now = () => timestamp({ withTimezone: true, mode: "date" }).notNull().defaultNow();

/** One row, `id: "default"`. A table rather than a YAML file so it comes free over GraphQL. */
export const settings = table("settings", {
  id: text().primaryKey().default("default"),
  /** Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter, ... */
  baseUrl: text().notNull().default("http://localhost:11434/v1"),
  /** Empty falls back to $OPENAI_API_KEY. Excluded from the GraphQL type — write-only. */
  apiKey: text().notNull().default(""),
  /** Default model for chat. Picked from the models the server reports. */
  model: text().notNull().default(""),
  maxTokens: integer().notNull().default(4096),
  temperature: real().notNull().default(0.7),
  /** Hard stop on runaway tool loops. */
  maxToolIterations: integer().notNull().default(20),
  systemPrompt: text().notNull().default("You are min-agent, a concise and careful assistant."),
  /** Context window in tokens. 0 asks the server, which not every server answers. */
  contextLimit: integer().notNull().default(0),
  /**
   * `eager` sends every MCP tool definition on every request. `ondemand` sends a name-only
   * catalogue and lets the model pull in the schemas it needs, mid-turn.
   */
  toolDiscovery: text({ enum: ["eager", "ondemand"] })
    .notNull()
    .default("ondemand"),
  /**
   * Per-task model overrides, keyed by the entries in `MODEL_TASKS`. Kept as an open JSON
   * object rather than a column each, so adding a task needs no migration.
   */
  taskModels: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** Optional, for the cost readout. Both 0 — the default for a local model — hides cost. */
  pricing: jsonb()
    .$type<{ inputPer1M: number; outputPer1M: number }>()
    .notNull()
    .default({ inputPer1M: 0, outputPer1M: 0 }),
});

export const mcpServers = table("mcp_servers", {
  /** Chosen by hand, and the namespace for this server's tools: `<id>__<tool name>`. */
  id: text().primaryKey(),
  label: text().notNull().default(""),
  enabled: boolean().notNull().default(true),
  transport: text({ enum: ["stdio", "http"] })
    .notNull()
    .default("stdio"),
  command: text().notNull().default(""),
  args: jsonb().$type<string[]>().notNull().default([]),
  env: jsonb().$type<Record<string, string>>().notNull().default({}),
  url: text().notNull().default(""),
  headers: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** The order the UI lists them in, which is the order they were added. */
  position: integer().notNull().default(0),
});

/**
 * Another web app with a place in the sidebar — a task board, a kanban server. min-agent does
 * not host or proxy it; it stores where the thing lives and renders it in a frame.
 */
export const embeds = table("embeds", {
  /** Chosen by hand, and the route the view lives at: `/embed/<id>`. */
  id: text().primaryKey(),
  label: text().notNull().default(""),
  url: text().notNull().default(""),
  /** A Feather glyph name from `EMBED_ICONS`. Anything else falls back to `grid` on read. */
  icon: text().notNull().default("grid"),
  /** `iframe` renders it inside the app; `external` always hands it to the browser. */
  mode: text({ enum: ["iframe", "external"] })
    .notNull()
    .default("iframe"),
  enabled: boolean().notNull().default(true),
  /** The order the sidebar lists them in, which is the order they were added. */
  position: integer().notNull().default(0),
});

export const sessions = table("sessions", {
  id: id(),
  title: text().notNull().default("New chat"),
  createdAt: now(),
  updatedAt: now().$onUpdateFn(() => new Date()),
  /** The model the last turn ran on. Empty falls back to the default in settings. */
  model: text().notNull().default(""),
  /** Running total across every turn in the session. */
  usage: jsonb().$type<TokenUsage>(),
  /** Tools pulled in on demand, kept for the rest of the session so they load once. */
  loadedTools: jsonb().$type<string[]>().notNull().default([]),
  /** Set once the transcript outgrew the window; the head is sent as a summary instead. */
  compaction: jsonb().$type<Compaction>(),
  /**
   * Kept in step by the store as messages are appended, so the session list is one query
   * over one table. This is the row that replaces the `.meta.json` sidecar the file store
   * needed for the same reason: the sidebar wants a count, not a transcript.
   */
  messageCount: integer().notNull().default(0),
});

export const messages = table(
  "messages",
  {
    id: id(),
    sessionId: text()
      .notNull()
      .references(() => sessions.id, { onDelete: "cascade" }),
    /** Position in the transcript, from 0. What the model replays is ordered by this. */
    idx: integer().notNull(),
    role: text({ enum: ["system", "developer", "user", "assistant", "tool"] }).notNull(),
    /** A string for most turns; the multimodal part arrays are JSON too, so this is JSON. */
    content: jsonb().$type<StoredMessage["content"]>(),
    /**
     * Ours, not the API's: servers that stream chain-of-thought on a side channel get it kept
     * here so the panel survives a reload. Stripped again before the history is replayed.
     */
    reasoningContent: text(),
    /** What the assistant asked to call, when it did. */
    toolCalls: jsonb().$type<ToolCall[]>(),
    /** Which call this row is the result of, on a `tool` message. */
    toolCallId: text(),
    /** Everything measured about the turn. Attached to its last assistant message. */
    stats: jsonb().$type<TurnStats>(),
    /** Questions worth asking next. Attached to the same message as `stats`. */
    followups: jsonb().$type<string[]>(),
    createdAt: now(),
  },
  (table) => [index("messages_session_idx").on(table.sessionId, table.idx)],
);

export const schema = { settings, mcpServers, embeds, sessions, messages };

export const relations = defineRelations(schema, (r) => ({
  sessions: {
    messages: r.many.messages({ from: r.sessions.id, to: r.messages.sessionId }),
  },
  messages: {
    session: r.one.sessions({ from: r.messages.sessionId, to: r.sessions.id, optional: false }),
  },
}));

export type SettingsRow = typeof settings.$inferSelect;
export type McpServerRow = typeof mcpServers.$inferSelect;
export type EmbedRow = typeof embeds.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
