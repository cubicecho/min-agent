import type OpenAI from "openai";
import { z } from "zod";

/** Everything under `config/*.yaml` is validated through these schemas. */

export const llmConfigSchema = z.object({
  /** Any OpenAI-compatible endpoint: OpenAI, Ollama, LM Studio, vLLM, OpenRouter, ... */
  baseUrl: z.string().min(1).default("http://localhost:11434/v1"),
  /** Left empty, the server falls back to $OPENAI_API_KEY. */
  apiKey: z.string().default(""),
  /** Default model for chat. Picked from the models the server reports. */
  model: z.string().default(""),
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

/**
 * Jobs that are not the main chat turn and do not need the main chat model. Each is small,
 * frequent, and latency-sensitive, which is exactly what a cheap model is good at.
 */
export const MODEL_TASKS = [
  {
    key: "compaction",
    label: "Context compaction",
    empty: "off — long sessions eventually overflow",
    hint: "Summarises the oldest messages once a session fills 75% of the context window, so it can keep going.",
  },
  {
    key: "toolSelect",
    label: "Tool preselection",
    empty: "off — the model loads its own tools",
    hint: "Guesses which tools a request needs before the turn starts, so the chat model usually skips the load step. Only used with on-demand tool discovery.",
  },
  {
    key: "followups",
    label: "Follow-up suggestions",
    empty: "off — no suggestions",
    hint: "Proposes a few next questions under each reply in a chat, as chips you can click to send.",
  },
  {
    key: "title",
    label: "Session title",
    empty: "off — use the first message",
    hint: "Names a new chat once, from its opening message. Left off, the first line is truncated instead.",
  },
] as const;

export type ModelTask = (typeof MODEL_TASKS)[number]["key"];

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

export const mcpFileSchema = z.object({ servers: z.array(mcpServerSchema).default([]) });

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

/** Sessions are stored on disk as one JSON file per session. */
/** What replaces the folded-away head of a long transcript. Written by the model, kept on disk. */
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
