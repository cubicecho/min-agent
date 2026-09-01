import type OpenAI from "openai";
import { z } from "zod";
import type { ModelTask } from "./model-tasks.ts";

/**
 * The settings and MCP rows live in Postgres, and GraphQL already checks the shape of a
 * write. These schemas are the range checks it cannot express — that `temperature` is
 * between 0 and 2, that an stdio server names a command — applied on the way into the
 * database and reused to fill in a row's defaults.
 */

export const llmConfigSchema = z.object({
  /** Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter, ... */
  baseUrl: z.string().min(1).default("http://localhost:11434/v1"),
  /** Left empty, the server falls back to $OPENAI_API_KEY. Write-only: never read back. */
  apiKey: z.string().default(""),
  /** Default model for chat. Picked from the models the server reports. */
  model: z.string().default(""),
  /**
   * The longest single reply, passed straight through as `max_tokens` on the completion. Not
   * the context window — that is `contextLimit` below, and the two are easy to confuse.
   *
   * The ceiling is a sanity guard rather than a real limit: no model accepts an output this
   * long, so the only thing it rejects is a context-sized number typed into the wrong box.
   * It has to be enforced on the way in as well as out — see `assertLlmConfigPatch`, which
   * exists because it once was not, and a value stored past it stopped the server booting.
   */
  maxTokens: z.number().int().min(1).max(200000).default(4096),
  temperature: z.number().min(0).max(2).default(0.7),
  /** Hard stop on runaway tool loops. */
  maxToolIterations: z.number().int().min(1).max(100).default(20),
  systemPrompt: z.string().default("You are min-agent, a concise and careful assistant."),
  /** Context window in tokens. 0 asks the server, which not every server answers. */
  contextLimit: z.number().int().min(0).default(0),
  /**
   * "eager" sends every MCP tool definition on every request. "ondemand" sends a name-only
   * catalogue and lets the model pull in the schemas it needs, mid-turn.
   */
  toolDiscovery: z.enum(["eager", "ondemand"]).default("ondemand"),
  /**
   * Per-task model overrides, keyed by the entries in `MODEL_TASKS`. A missing or empty value
   * means the task is off (or falls back to `model`, per the task). Kept as an open record so
   * adding a task needs no config migration — unknown keys are simply ignored.
   */
  taskModels: z.record(z.string(), z.string()).default({}),
  /** Optional, for the cost readout. Leave at 0 for local models — cost is then hidden. */
  pricing: z
    .object({
      inputPer1M: z.number().min(0).default(0),
      outputPer1M: z.number().min(0).default(0),
    })
    .default({ inputPer1M: 0, outputPer1M: 0 }),
});
export type LlmConfig = z.infer<typeof llmConfigSchema>;

/** The model to use for a side task, or "" when it is not configured. */
export const modelForTask = (config: LlmConfig, task: ModelTask) =>
  config.taskModels?.[task]?.trim() || "";

/** What the API hands the browser — never the key itself. */
export type LlmConfigView = Omit<LlmConfig, "apiKey"> & { hasApiKey: boolean };

export const mcpServerSchema = z
  .object({
    id: z
      .string()
      .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,31}$/, "id must be 1-32 chars: letters, digits, _ or -"),
    label: z.string().default(""),
    enabled: z.boolean().default(true),
    transport: z.enum(["stdio", "http"]).default("stdio"),
    // stdio
    command: z.string().default(""),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    // streamable http
    url: z.string().default(""),
    headers: z.record(z.string(), z.string()).default({}),
  })
  .superRefine((server, ctx) => {
    if (server.transport === "stdio" && !server.command) {
      ctx.addIssue({ code: "custom", path: ["command"], message: "command is required for stdio" });
    }
    if (server.transport === "http" && !server.url) {
      ctx.addIssue({ code: "custom", path: ["url"], message: "url is required for http" });
    }
  });
export type McpServerConfig = z.infer<typeof mcpServerSchema>;

/** One function call the model asked for, as the chat-completions API spells it. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Token counts reported by the server for a turn, or summed over a session. */
export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export const emptyUsage = (): TokenUsage => ({
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
});

/**
 * Everything measured about one user turn — a turn being the whole round trip, including any
 * tool iterations. Timings are the server's; token counts come from the model server, so any of
 * them can be missing when it does not report usage.
 */
export interface TurnStats extends TokenUsage {
  model: string;
  /** Wall clock for the whole turn, tool execution included. */
  totalMs: number;
  /** Request sent to first token out. */
  ttftMs?: number;
  /** First token to last token, which is what tokensPerSecond is measured over. */
  generationMs?: number;
  tokensPerSecond?: number;
  /** How many times we went back to the model, and how many tools it asked for. */
  iterations: number;
  toolCalls: number;
  /** Prompt + completion of the final round trip: what the next turn starts from. */
  contextTokens?: number;
  /** The model's window, when the server reports one or you set it in Config. */
  contextLimit?: number;
}

export interface ModelInfo {
  id: string;
  contextLength?: number;
}

/**
 * A stored turn. `reasoning_content` is ours — servers that stream chain-of-thought
 * on that side channel get it kept here so the panel survives a reload, and it is
 * stripped again before the history is replayed to the model.
 */
export type StoredMessage = OpenAI.ChatCompletionMessageParam & {
  reasoning_content?: string;
  /** Attached to the last assistant message of a turn. */
  stats?: TurnStats;
  /** Questions worth asking next. Attached to the same message as `stats`. */
  followups?: string[];
};

/** What replaces the folded-away head of a long transcript. Written by the model, kept in pg. */
export interface Compaction {
  /** The model's notes on messages `[0, through)`. */
  summary: string;
  /** Index into `messages`: everything before it is represented by the summary. */
  through: number;
  /** When it was written, so the chat can show where history was folded. */
  at: string;
}

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  model?: string;
  /** Running total across every turn in the session. */
  usage?: TokenUsage;
  /** Tools pulled in on demand, kept for the rest of the session so they load once. */
  loadedTools?: string[];
  /** Set once the transcript outgrew the window; the head is sent as a summary instead. */
  compaction?: Compaction;
  /** Raw chat-completions turns — replayed verbatim on the next request. */
  messages: StoredMessage[];
}

/**
 * A session without its transcript, which is what the sidebar lists. `messageCount` is a
 * column on the session rather than a count over the messages: the list is read after every
 * turn, and it has no business touching the messages table to draw a column of titles.
 */

export type SessionSummary = Omit<Session, "messages"> & { messageCount: number };

export type McpStatus = "disabled" | "connecting" | "ready" | "error";

export interface McpServerState {
  config: McpServerConfig;
  status: McpStatus;
  error?: string;
  tools: { name: string; description: string }[];
}

/** Server-sent events emitted while a turn is running. */
export type StreamEvent =
  | { type: "reasoning_delta"; text: string }
  | { type: "text_delta"; text: string }
  | { type: "tool_use"; id: string; name: string; input: string }
  | { type: "tool_result"; toolUseId: string; content: string; isError: boolean }
  | { type: "title"; title: string }
  | { type: "stats"; stats: TurnStats }
  | { type: "done" }
  // Follow-up chips are written after `done`, so a turn that produces them keeps the stream
  // open a moment past the answer. A client that ignores this event still gets them on the
  // next read of the session.
  | { type: "followups"; items: string[] }
  | { type: "error"; message: string };
