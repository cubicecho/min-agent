import OpenAI from "openai";
import {
  emptyUsage,
  type ModelInfo,
  type Session,
  type StoredMessage,
  type StreamEvent,
  type TokenUsage,
  type TurnStats,
} from "../shared/types.ts";
import { loadLlmConfig, resolveApiKey } from "./config.ts";
import { mcp } from "./mcp.ts";
import { saveSession } from "./store.ts";
import {
  catalogPrompt,
  expandNames,
  inCatalog,
  LOAD_TOOLS,
  loadResult,
  loadToolsDefinition,
  requestedNames,
} from "./tool-loading.ts";

/** Local servers usually ignore the key, but the SDK insists on a non-empty one. */
export function getClient(config = loadLlmConfig()) {
  return new OpenAI({ baseURL: config.baseUrl, apiKey: resolveApiKey(config) || "min-agent" });
}

/** Servers name the context window half a dozen ways; take the first one that shows up. */
const CONTEXT_KEYS = [
  "context_length",
  "max_context_window",
  "max_model_len",
  "context_window",
  "n_ctx",
];

function contextLengthOf(model: object): number | undefined {
  const record = model as Record<string, unknown>;
  for (const key of CONTEXT_KEYS) {
    const value = record[key];
    if (typeof value === "number" && value > 0) return value;
  }
  return undefined;
}

/** Last known model list, so a turn can look up a context window without a round trip. */
let modelCache: ModelInfo[] = [];

export async function listModels(): Promise<ModelInfo[]> {
  const { data } = await getClient().models.list();
  modelCache = data
    .map((model) => ({ id: model.id, contextLength: contextLengthOf(model) }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return modelCache;
}

/** Best effort — a server that will not list models still has to be able to run a turn. */
async function contextLimitFor(model: string, override: number): Promise<number | undefined> {
  if (override) return override;
  if (!modelCache.length) {
    try {
      await listModels();
    } catch {
      return undefined;
    }
  }
  return modelCache.find((entry) => entry.id === model)?.contextLength;
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New chat";
}

/** Some servers stream chain-of-thought on a side channel. */
type Delta = OpenAI.ChatCompletionChunk.Choice.Delta & {
  reasoning_content?: string | null;
  reasoning?: string | null;
};

/**
 * Drops our own `reasoning_content` and `stats` before the history goes back over the wire —
 * they are display artifacts, and strict servers reject unknown message fields.
 */
function forApi(messages: StoredMessage[]): OpenAI.ChatCompletionMessageParam[] {
  return messages.map((message) => {
    if (!("reasoning_content" in message) && !("stats" in message)) return message;
    const copy = { ...message } as StoredMessage;
    delete copy.reasoning_content;
    delete copy.stats;
    return copy as OpenAI.ChatCompletionMessageParam;
  });
}

/** Not every OpenAI-compatible server accepts `stream_options`; we find out once. */
let usageSupported = true;

export interface RunOptions {
  session: Session;
  prompt: string;
  model?: string;
  onEvent?: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Runs one user turn to completion: streams the reply, executes any MCP tool
 * calls, and loops until the model stops asking for tools. The session file is
 * written after every turn, so a crash mid-run still leaves readable history.
 */
export async function runTurn({ session, prompt, model, onEvent, signal }: RunOptions) {
  const config = loadLlmConfig();
  const chosenModel = model || session.model || config.model;
  if (!chosenModel) throw new Error("No model selected — pick one in Config.");

  const emit = onEvent ?? (() => {});
  const client = getClient(config);
  const contextLimit = await contextLimitFor(chosenModel, config.contextLimit);

  // In on-demand mode the model sees a name-only catalogue up front and pulls in the
  // definitions it needs as the turn runs; `loaded` grows between iterations.
  const catalog = mcp.catalog();
  const onDemand = config.toolDiscovery === "ondemand" && catalog.length > 0;
  const loaded = new Set(session.loadedTools ?? []);
  const systemPrompt = onDemand
    ? `${config.systemPrompt}\n\n${catalogPrompt(catalog)}`
    : config.systemPrompt;

  session.model = chosenModel;
  session.messages.push({ role: "user", content: prompt });
  if (session.title === "New chat") {
    session.title = titleFrom(prompt);
    emit({ type: "title", title: session.title });
  }
  saveSession(session);

  const turnUsage = emptyUsage();
  const banked = session.usage ?? emptyUsage();
  const startedAt = Date.now();
  let firstTokenAt = 0;
  let lastTokenAt = 0;
  let toolCalls = 0;
  let iterations = 0;
  let lastRoundTrip = emptyUsage();

  for (let iteration = 0; iteration < config.maxToolIterations; iteration++) {
    const tools = onDemand ? [loadToolsDefinition(), ...mcp.tools([...loaded])] : mcp.tools();

    const open = (withUsage: boolean) =>
      client.chat.completions.create(
        {
          model: chosenModel,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: true,
          ...(withUsage ? { stream_options: { include_usage: true } } : {}),
          messages: [{ role: "system", content: systemPrompt }, ...forApi(session.messages)],
          ...(tools.length ? { tools } : {}),
        },
        { signal },
      );

    let stream: Awaited<ReturnType<typeof open>>;
    try {
      stream = await open(usageSupported);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (!usageSupported || !/stream_options/i.test(detail)) throw error;
      console.warn("[agent] server rejected stream_options; token counts disabled");
      usageSupported = false;
      stream = await open(false);
    }

    iterations++;
    const before = { ...turnUsage };
    let text = "";
    let reasoning = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();

    for await (const chunk of stream) {
      if (chunk.usage) {
        turnUsage.promptTokens += chunk.usage.prompt_tokens ?? 0;
        turnUsage.completionTokens += chunk.usage.completion_tokens ?? 0;
        turnUsage.totalTokens += chunk.usage.total_tokens ?? 0;
      }

      const delta = chunk.choices[0]?.delta as Delta | undefined;
      if (!delta) continue;

      const thought = delta.reasoning_content ?? delta.reasoning;
      if (thought || delta.content) {
        if (!firstTokenAt) firstTokenAt = Date.now();
        lastTokenAt = Date.now();
      }
      if (thought) {
        reasoning += thought;
        emit({ type: "reasoning_delta", text: thought });
      }
      if (delta.content) {
        text += delta.content;
        emit({ type: "text_delta", text: delta.content });
      }
      for (const call of delta.tool_calls ?? []) {
        const current = calls.get(call.index) ?? { id: "", name: "", args: "" };
        if (call.id) current.id = call.id;
        if (call.function?.name) current.name += call.function.name;
        if (call.function?.arguments) current.args += call.function.arguments;
        calls.set(call.index, current);
      }
    }

    lastRoundTrip = {
      promptTokens: turnUsage.promptTokens - before.promptTokens,
      completionTokens: turnUsage.completionTokens - before.completionTokens,
      totalTokens: turnUsage.totalTokens - before.totalTokens,
    };

    const roundTripCalls = [...calls.values()].filter((call) => call.name);
    // Loading a definition is bookkeeping, not work the model did for the user.
    toolCalls += roundTripCalls.filter((call) => call.name !== LOAD_TOOLS).length;
    const assistant: StoredMessage = {
      role: "assistant",
      content: text || null,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(roundTripCalls.length
        ? {
            tool_calls: roundTripCalls.map((call) => ({
              id: call.id,
              type: "function" as const,
              function: { name: call.name, arguments: call.args || "{}" },
            })),
          }
        : {}),
    };
    session.messages.push(assistant);
    session.usage = add(banked, turnUsage);
    saveSession(session);

    if (!roundTripCalls.length) {
      const stats: TurnStats = {
        ...turnUsage,
        model: chosenModel,
        totalMs: Date.now() - startedAt,
        iterations,
        toolCalls,
        ...(firstTokenAt ? { ttftMs: firstTokenAt - startedAt } : {}),
        ...(firstTokenAt && lastTokenAt > firstTokenAt
          ? {
              generationMs: lastTokenAt - firstTokenAt,
              ...(turnUsage.completionTokens
                ? {
                    tokensPerSecond:
                      turnUsage.completionTokens / ((lastTokenAt - firstTokenAt) / 1000),
                  }
                : {}),
            }
          : {}),
        ...(lastRoundTrip.totalTokens
          ? { contextTokens: lastRoundTrip.promptTokens + lastRoundTrip.completionTokens }
          : {}),
        ...(contextLimit ? { contextLimit } : {}),
      };
      assistant.stats = stats;
      saveSession(session);
      emit({ type: "stats", stats });
      return stats;
    }

    for (const call of roundTripCalls) {
      emit({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      let content: string;
      let isError = false;
      try {
        const args = parseArgs(call.args);
        if (call.name === LOAD_TOOLS) {
          const { matched, unknown } = expandNames(requestedNames(args), catalog);
          for (const name of matched) loaded.add(name);
          session.loadedTools = [...loaded];
          content = loadResult(matched, unknown, catalog);
          isError = matched.length === 0;
        } else {
          // A model that skips `load_tools` and calls a catalogued tool straight from its
          // name is right about what it wants; load it and run it rather than erroring.
          if (onDemand && !loaded.has(call.name) && inCatalog(catalog, call.name)) {
            loaded.add(call.name);
            session.loadedTools = [...loaded];
          }
          content = await mcp.call(call.name, args);
        }
      } catch (error) {
        content = error instanceof Error ? error.message : String(error);
        isError = true;
      }
      emit({ type: "tool_result", toolUseId: call.id, content, isError });
      session.messages.push({ role: "tool", tool_call_id: call.id, content });
    }
    saveSession(session);
  }

  throw new Error(`Stopped after ${config.maxToolIterations} tool iterations.`);
}

const add = (a: TokenUsage | undefined, b: TokenUsage): TokenUsage => ({
  promptTokens: (a?.promptTokens ?? 0) + b.promptTokens,
  completionTokens: (a?.completionTokens ?? 0) + b.completionTokens,
  totalTokens: (a?.totalTokens ?? 0) + b.totalTokens,
});

function parseArgs(args: string): Record<string, unknown> {
  if (!args.trim()) return {};
  try {
    return JSON.parse(args) as Record<string, unknown>;
  } catch {
    throw new Error(`model produced invalid tool arguments: ${args.slice(0, 200)}`);
  }
}
