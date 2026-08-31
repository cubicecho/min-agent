import OpenAI from "openai";
import {
  emptyUsage,
  type LlmConfig,
  type ModelInfo,
  modelForTask,
  type Session,
  type StoredMessage,
  type StreamEvent,
  type TokenUsage,
  type TurnStats,
} from "../shared/types.ts";
import {
  compactionMessage,
  needsCompaction,
  planCompaction,
  SUMMARY_PROMPT,
  transcriptFor,
} from "./compaction.ts";
import { loadLlmConfig, resolveApiKey } from "./config.ts";
import { type CatalogServer, mcp } from "./mcp.ts";
import { isGrammarError, relaxTools, sanitizeTools } from "./schema-compat.ts";
import { ask, clean, listLines, parseJson, tryAsk } from "./side-tasks.ts";
import { saveSession } from "./store.ts";
import {
  carryOver,
  catalogPrompt,
  expandNames,
  inCatalog,
  LOAD_TOOLS,
  loadResult,
  loadToolsDefinition,
  PRESELECT_SYSTEM,
  preselectInput,
  preselection,
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

/**
 * Folds the settled head of a long transcript into a summary, if it has grown far enough into
 * the window to need it. Returns a note for the log; the work is the mutation of `session`.
 *
 * The messages themselves are never deleted — only `compaction.through` moves — so the chat
 * still shows the whole history and the next compaction can build on this summary.
 */
async function compact(
  session: Session,
  config: LlmConfig,
  model: string,
  contextLimit: number,
  signal?: AbortSignal,
): Promise<string> {
  const used = latestContextTokens(session);
  if (!needsCompaction(used, contextLimit)) return "";

  const from = session.compaction?.through ?? 0;
  const through = planCompaction(session.messages, from, contextLimit);
  if (through === undefined) return "";

  const previous = session.compaction
    ? `Notes so far:\n${session.compaction.summary}\n\nContinue them with this exchange:\n\n`
    : "";
  const summary = await ask(
    config,
    model,
    SUMMARY_PROMPT,
    previous + transcriptFor(session.messages, from, through),
    { maxTokens: 1024, signal },
  );
  if (!summary) return "";

  session.compaction = { summary, through, at: new Date().toISOString() };
  saveSession(session);
  console.log(`[agent] compacted ${through} message(s) at ${used}/${contextLimit} tokens`);
  return summary;
}

/** What the last turn actually cost, which is the best estimate of what the next one will. */
function latestContextTokens(session: Session): number {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const { stats } = session.messages[i];
    if (stats?.contextTokens) return stats.contextTokens;
  }
  return 0;
}

/**
 * Names a session from its opening message, using whichever model is configured for the task.
 *
 * Runs alongside the turn rather than before it, so it never delays the first token — a small
 * model finishes long before the chat model is done answering.
 */
async function generateTitle(
  config: LlmConfig,
  model: string,
  prompt: string,
  signal?: AbortSignal,
): Promise<string> {
  const reply = await ask(
    config,
    model,
    "You name conversations. Reply with a title of at most six words for a chat that opens " +
      "with the message below. Reply with the title alone — no quotes, no trailing punctuation, " +
      "no preamble.",
    prompt.slice(0, 2000),
    { signal },
  );
  const title = clean(reply.split("\n").filter(Boolean).pop() ?? "");
  return title.length > 60 ? `${title.slice(0, 57)}…` : title;
}

/**
 * Guesses the tools this request will need, before the turn starts.
 *
 * On-demand loading otherwise spends a round trip of the chat model on reading the catalogue
 * and calling `load_tools`. A small model reading the same catalogue usually picks the right
 * names, and then the chat model opens the turn with them already in hand.
 *
 * Guessing wrong is cheap: an unused definition costs a few hundred tokens for one turn, does
 * not carry over, and the model can still load what it actually wanted. So this never blocks
 * or overrides the model's own loading — it only tries to make it unnecessary.
 */
async function preselect(
  config: LlmConfig,
  model: string,
  catalog: CatalogServer[],
  prompt: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const reply = await ask(config, model, PRESELECT_SYSTEM, preselectInput(catalog, prompt), {
    maxTokens: 256,
    signal,
  });
  const chosen = preselection(parseJson<unknown>(reply), catalog);
  if (chosen.length) console.log(`[agent] preselected: ${chosen.join(", ")}`);
  return chosen;
}

/** Cap on suggestions offered, and on the length of one before it stops reading as a chip. */
const MAX_FOLLOWUPS = 3;
const MAX_FOLLOWUP_CHARS = 80;

/**
 * Three questions worth asking next, from the exchange that just happened.
 *
 * These are cheap to ignore and occasionally save a round of typing, so the bar is that they be
 * *specific*: "what does the 0.16 async rewrite change for existing code" earns its place,
 * "tell me more" does not. Anything too long to read at a glance is dropped rather than
 * truncated — a chip that has to be squinted at is worse than one fewer chip.
 */
async function suggestFollowups(
  config: LlmConfig,
  model: string,
  prompt: string,
  reply: string,
  signal?: AbortSignal,
): Promise<string[]> {
  const text = await ask(
    config,
    model,
    `Below is a question and the answer it got. Suggest at most ${MAX_FOLLOWUPS} questions the ` +
      "person might sensibly ask next. Each must be specific to what was actually said and " +
      'answerable from here — no generic invitations like "tell me more". Write them as the ' +
      "person would type them, under a dozen words each, one per line, nothing else.",
    `Question:\n${prompt.slice(0, 2000)}\n\nAnswer:\n${reply.slice(0, 6000)}`,
    { maxTokens: 200, signal },
  );
  return listLines(text, MAX_FOLLOWUPS, MAX_FOLLOWUP_CHARS);
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
/**
 * The transcript as the server should see it: private bookkeeping stripped, and — once a
 * session has been compacted — the folded head replaced by its summary.
 */
function forApi(session: Session): OpenAI.ChatCompletionMessageParam[] {
  const { compaction } = session;
  const messages = compaction
    ? [compactionMessage(compaction), ...session.messages.slice(compaction.through)]
    : session.messages;
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

/**
 * llama.cpp-backed servers compile all tool schemas into one grammar and reject keywords
 * their converter cannot express. Once we have seen that, drop them for the rest of the run.
 */
let strictSchemas = true;

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
  const carried = session.loadedTools ?? [];
  const loaded = new Set(carried);
  // Only tools the model actually *called* carry over to the next turn. Everything else it
  // pulled in was a guess, and keeping the guesses would grow the tool array turn over turn
  // until it is larger than eager mode's — which is the situation on-demand loading exists to
  // avoid, and which sends the model wandering into unrelated tools.
  const used = new Set<string>();
  // Recomputed each iteration: `loaded` grows as the turn runs, and the catalogue has to stop
  // advertising a tool the moment the model can actually call it.
  const systemPromptFor = () =>
    onDemand
      ? `${config.systemPrompt}\n\n${catalogPrompt(catalog, loaded)}`.trim()
      : config.systemPrompt;

  // Two small-model calls have to land before the first token is asked for, and neither depends
  // on the other, so they overlap. Compaction goes before the user's message is appended, so the
  // summary covers settled history and the question that prompted it stays verbatim.
  const window = contextLimit ?? 0;
  const compactionModel = window ? modelForTask(config, "compaction") : "";
  const preselectModel = onDemand ? modelForTask(config, "toolSelect") : "";
  const [, preselected = []] = await Promise.all([
    compactionModel
      ? tryAsk("compaction", () => compact(session, config, compactionModel, window, signal))
      : undefined,
    preselectModel
      ? tryAsk("preselect", () => preselect(config, preselectModel, catalog, prompt, signal))
      : undefined,
  ]);

  session.model = chosenModel;
  session.messages.push({ role: "user", content: prompt });
  for (const name of preselected) loaded.add(name);

  // The truncated first line goes up immediately so the sidebar is never blank, and a model
  // titles it properly in the background if one is configured for the job.
  let titling: Promise<void> | undefined;
  if (session.title === "New chat") {
    session.title = titleFrom(prompt);
    emit({ type: "title", title: session.title });

    const titleModel = modelForTask(config, "title");
    if (titleModel) {
      titling = tryAsk("title", () => generateTitle(config, titleModel, prompt, signal)).then(
        (title) => {
          if (!title) return;
          session.title = title;
          emit({ type: "title", title });
        },
      );
    }
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
  // Identical call -> identical result. Replaying it from here ends the repeat loops a model
  // falls into when a tool disappoints it, without spending another MCP round trip.
  const answered = new Map<string, string>();

  for (let iteration = 0; iteration < config.maxToolIterations; iteration++) {
    // With a preselection in hand the first step gets the shortlist and nothing else — no
    // catalogue, no `load_tools`. Left with the menu in front of it the model shops: it reloads
    // what it already has, or picks a sibling of the right tool and works its way through the
    // rest. Taking the menu away for one step removes the choice, and everything comes back on
    // the step after, so it can still reach for anything it turns out to need.
    const routed = preselected.length > 0 && iteration === 0;
    const declared = sanitizeTools(
      routed
        ? mcp.tools(preselected)
        : onDemand
          ? [loadToolsDefinition(), ...mcp.tools([...loaded])]
          : mcp.tools(),
    );

    const open = (withUsage: boolean, strict: boolean) => {
      const tools = strict ? declared : relaxTools(declared);
      return client.chat.completions.create(
        {
          model: chosenModel,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          stream: true,
          ...(withUsage ? { stream_options: { include_usage: true } } : {}),
          messages: [
            { role: "system", content: routed ? config.systemPrompt : systemPromptFor() },
            ...forApi(session),
          ],
          ...(tools.length ? { tools } : {}),
        },
        { signal },
      );
    };

    let stream: Awaited<ReturnType<typeof open>>;
    try {
      stream = await open(usageSupported, strictSchemas);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (usageSupported && /stream_options/i.test(detail)) {
        console.warn("[agent] server rejected stream_options; token counts disabled");
        usageSupported = false;
        stream = await open(false, strictSchemas);
      } else if (strictSchemas && isGrammarError(detail)) {
        console.warn("[agent] server could not build a grammar; retrying without pattern/format");
        strictSchemas = false;
        stream = await open(usageSupported, false);
      } else throw error;
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
      if (onDemand) session.loadedTools = carryOver(carried, used);
      await titling;
      saveSession(session);
      emit({ type: "stats", stats });

      // After the answer, not before: it is on screen and being read by the time this runs, so
      // the second it costs is spent where nobody is waiting on it. The chips are read back off
      // the stored message, so they survive a reload without a second delivery path.
      const followupModel = modelForTask(config, "followups");
      const body = typeof assistant.content === "string" ? assistant.content : "";
      if (followupModel && body) {
        const followups = await tryAsk("followups", () =>
          suggestFollowups(config, followupModel, prompt, body, signal),
        );
        if (followups?.length) {
          assistant.followups = followups;
          saveSession(session);
        }
      }
      return stats;
    }

    for (const call of roundTripCalls) {
      emit({ type: "tool_use", id: call.id, name: call.name, input: call.args });
      let content: string;
      let isError = false;
      try {
        const args = parseArgs(call.args);
        if (call.name === LOAD_TOOLS) {
          const resolved = expandNames(requestedNames(args), catalog);
          for (const name of resolved.matched) loaded.add(name);
          content = loadResult(resolved, catalog);
          isError = resolved.matched.length === 0;
        } else {
          // A model that skips `load_tools` and calls a catalogued tool straight from its
          // name is right about what it wants; load it and run it rather than erroring.
          if (onDemand && !loaded.has(call.name) && inCatalog(catalog, call.name))
            loaded.add(call.name);
          used.add(call.name);

          const key = `${call.name}\u0000${call.args}`;
          const previous = answered.get(key);
          if (previous === undefined) {
            content = await mcp.call(call.name, args);
            answered.set(key, content);
          } else {
            content = `${previous}\n\n(Identical call already made this turn; the result is unchanged. Use it rather than calling again.)`;
          }
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
