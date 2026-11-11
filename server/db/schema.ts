import type { TokenLedger } from "@cubicecho/agent-core";
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
import { MODEL_DEFAULTS } from "../../shared/defaults.ts";
import type {
  Session,
  StoredMessage,
  TokenUsage,
  ToolCall,
  ToolHookConfig,
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
  maxTokens: integer().notNull().default(MODEL_DEFAULTS.maxTokens),
  temperature: real().notNull().default(MODEL_DEFAULTS.temperature),
  /** Hard stop on runaway tool loops. */
  maxToolIterations: integer().notNull().default(MODEL_DEFAULTS.maxToolIterations),
  systemPrompt: text().notNull().default("You are min-agent, a concise and careful assistant."),
  /** Context window in tokens. 0 asks the server, which not every server answers. */
  contextLimit: integer().notNull().default(0),
  /**
   * `eager` sends every MCP tool definition on every request. `ondemand` sends a name-only
   * catalogue and lets the model pull in the schemas it needs, mid-turn. `proxy` does the same
   * with a tool array that never changes, so a load does not cost the prompt cache.
   */
  toolDiscovery: text({ enum: ["eager", "ondemand", "proxy"] })
    .notNull()
    .default("ondemand"),
  /**
   * `reasoning_effort` on the completion, or `off` to leave the field off it. Spelled out
   * here rather than taken from `REASONING_EFFORTS` for the same reason `toolDiscovery` is:
   * this file is read by drizzle-kit, which loads it on its own to diff the schema.
   */
  reasoningEffort: text({
    enum: ["off", "none", "minimal", "low", "medium", "high", "xhigh", "max"],
  })
    .notNull()
    .default("off"),
  /**
   * Which assistant messages carry the model's thinking back to it: `all`, `tool-loop` (only the
   * ones that end in tool calls, during the turn that made them) or `none`. agent-core's
   * `ReasoningReplay`, defaulting where it does. See `forApi`.
   *
   * Plain text rather than an enum column, because a GraphQL enum value cannot hold a hyphen and
   * the generated one would be `Option1` for `tool-loop`. `REASONING_REPLAYS` is the check, on the
   * way in and on the way out, as it is for every bound the column type cannot say.
   */
  reasoningReplay: text().notNull().default("all"),
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
  /**
   * Where the audio endpoints live, when they are not where the chat model lives. Blank —
   * the usual case — means `baseUrl`. A chat server rarely does audio too: Ollama does not,
   * so `sttModel` on its own would be a model name sent somewhere that has never heard of
   * `/audio/transcriptions`. The key is not doubled; `resolveApiKey` serves both.
   */
  voiceBaseUrl: text().notNull().default(""),
  /**
   * Transcription model, e.g. `whisper-1`. Blank leaves dictation to whatever the device
   * already has — the browser's own speech recognition, or the microphone key on a phone
   * keyboard.
   */
  sttModel: text().notNull().default(""),
  /** Speech model, e.g. `tts-1`. Blank reads replies with the device's own voice. */
  ttsModel: text().notNull().default(""),
  /** Which voice `ttsModel` should use, e.g. `alloy`. Blank takes the server's default. */
  ttsVoice: text().notNull().default(""),
  /** Read every reply aloud as it lands, rather than waiting to be asked. */
  speakReplies: boolean().notNull().default(false),
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
  /** Tools only this row's hooks may call; the model is never offered them. */
  hiddenTools: jsonb().$type<string[]>().notNull().default([]),
  /**
   * Whether the pool may believe this server's tool annotations, which decides what a turn runs in
   * parallel: a call whose tool declares `readOnlyHint` runs beside the step's other reads, and any
   * other call — or every call, with this off — runs alone, in the place the model asked for it.
   *
   * On by default, unlike the pool's own default, because every row here is a server somebody
   * added by hand to their own assistant, and because believing a lie costs no more than the turn
   * did before the predicate existed: every call ran in parallel then. The pool's result cache,
   * which is where a false `readOnlyHint` swallows a second `send_email`, is not turned on here.
   * Off is for a server that marks a tool with side effects as read-only.
   */
  trustAnnotations: boolean().notNull().default(true),
  /** This server's own tools, called by min-agent at points in a session. See `ToolHookConfig`. */
  hooks: jsonb().$type<ToolHookConfig[]>().notNull().default([]),
  /** The order the UI lists them in, which is the order they were added. */
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
  compaction: jsonb().$type<NonNullable<Session["compaction"]>>(),
  /** How far old tool results are sent as stubs. Null until the rule first moves it. */
  pruning: jsonb().$type<NonNullable<Session["pruning"]>>(),
  /**
   * What each request a turn sent reported its prompt as, and how far into `messages` it reached:
   * agent-core's token ledger, indexed into the stored transcript. Two entries of one epoch
   * subtract to what the messages between them cost, which is what a fold is planned from where
   * there is a reading — see `server/compaction.ts`. The runner's cache rather than anything a
   * person sets, so it is kept out of the API.
   */
  ledger: jsonb().$type<TokenLedger>().notNull().default([]),
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
     * What the model thought before this reply, from whichever side channel it streamed on. Kept
     * so the panel survives a reload, and sent back to the model as `reasoningReplay` says.
     */
    reasoningContent: text(),
    /**
     * The field the thinking arrived in, and so the one it goes back under: llama.cpp reads only
     * `reasoning_content` and Ollama's `/v1` only `reasoning`. Null is `reasoning_content`, which
     * is what every row from before this column was.
     */
    reasoningField: text({ enum: ["reasoning_content", "reasoning"] }),
    /** OpenRouter's `reasoning_details` blocks, which it wants back byte for byte, in order. */
    reasoningDetails: jsonb().$type<Record<string, unknown>[]>(),
    /**
     * What the servers' hooks added to this question, on a `user` row. Kept apart from `content`,
     * which is what the user typed, and sent ahead of it on every later request too: dropped from
     * a past question, the request changes there and the prompt cache is lost from it on.
     */
    hookContext: text(),
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

export const schema = { settings, mcpServers, sessions, messages };

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
export type SessionRow = typeof sessions.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;
export type NewMessageRow = typeof messages.$inferInsert;
