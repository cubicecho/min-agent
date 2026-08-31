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
  /** Optional, for the cost readout. Leave at 0 for local models — cost is then hidden. */
  pricing: z
    .object({
      inputPer1M: z.number().min(0).default(0),
      outputPer1M: z.number().min(0).default(0),
    })
    .default({ inputPer1M: 0, outputPer1M: 0 }),
});
export type LlmConfig = z.infer<typeof llmConfigSchema>;

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

export const cronJobSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/),
  name: z.string().min(1),
  /** Standard 5-field cron expression. */
  schedule: z.string().min(1),
  timezone: z.string().default(""),
  enabled: z.boolean().default(true),
  /** Empty means "use the default model from config". */
  model: z.string().default(""),
  prompt: z.string().min(1),
});
export type CronJob = z.infer<typeof cronJobSchema>;

export const cronFileSchema = z.object({ jobs: z.array(cronJobSchema).default([]) });

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
};

/** Sessions are stored on disk as one JSON file per session. */
export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  source: "chat" | "cron";
  cronJobId?: string;
  model?: string;
  /** Running total across every turn in the session. */
  usage?: TokenUsage;
  /** Tools pulled in on demand, kept for the rest of the session so they load once. */
  loadedTools?: string[];
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

/** One execution of a cron job, kept in `data/cron-runs.json`. */
export interface CronRun {
  jobId: string;
  startedAt: string;
  finishedAt: string;
  status: "ok" | "error";
  error?: string;
  sessionId: string;
  usage?: TokenUsage;
}

export interface CronJobState {
  job: CronJob;
  nextRun?: string;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string;
  lastSessionId?: string;
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
  | { type: "error"; message: string };
