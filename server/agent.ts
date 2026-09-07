import {
  ask,
  backoffMs,
  type Capabilities,
  type CatalogServer,
  ContextOverflow,
  capabilitiesFor,
  carryOver,
  catalogPrompt,
  clean,
  compact as compactTokens,
  contextLimitFor,
  errorMessage,
  expandNames,
  getClient,
  inCatalog,
  isOverflow,
  isTransient,
  LOAD_TOOLS,
  LOAD_TOOLS_DEFINITION,
  listModels as listEndpointModels,
  listLines,
  loadResult,
  modelCapabilitiesFor,
  negotiate,
  PRESELECT_SYSTEM,
  parseJson,
  preselectInput,
  preselection,
  relaxTools,
  requestedNames,
  sanitizeTools,
  sleep,
  tryAsk,
} from "@cubicecho/agent-core";
import type OpenAI from "openai";
import { measureRequest, splitContext } from "../shared/client/usage.ts";
import {
  type ContextBreakdown,
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
import { endpoint, loadLlmConfig } from "./config.ts";
import * as mcp from "./mcp.ts";
import { addMessage, patchMessage, updateSession } from "./store.ts";

/** What the configured endpoint serves, id-sorted, with whatever window it declares. */
export async function listModels(): Promise<ModelInfo[]> {
  return listEndpointModels(endpoint());
}

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? "";
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New chat";
}

/**
 * Where agent-core's notices go. It prints nothing on its own — a library that writes to the
 * console picks its consumer's log for it — so anything not handed this is given up on in
 * silence.
 *
 * Worth passing everywhere, because most of what arrives here latches for the life of the
 * process and this line is the only announcement that it did: `sendNegotiated` for the chat
 * model, and the side tasks, which have negotiated their own requests since agent-core 2.1.2.
 * Since 2.2.0 a notice opens with what refused — the model by name, or `server` — so the source
 * survives the one prefix added here. That matters more here than in most consumers: five
 * settings pick models independently, so "which model" is not answerable from context.
 *
 * 2.2.1 closed the last line that broke that convention: the no-thinking hints latch per
 * (endpoint, model) and used to announce themselves as `server` (cubicecho/agent-core#51). What
 * still reads as `server` says so truthfully — a grammar it could not build, a `stream_options`
 * it has not heard of — because those two latch per endpoint and no model is implicated.
 */
const notice = (message: string) => console.warn(`[agent] ${message}`);

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
    endpoint(config),
    model,
    SUMMARY_PROMPT,
    previous + transcriptFor(session.messages, from, through),
    { maxTokens: 1024, signal, onNotice: notice },
  );
  if (!summary) return "";

  session.compaction = { summary, through, at: new Date().toISOString() };
  await updateSession(session.id, { compaction: session.compaction });
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
    endpoint(config),
    model,
    "You name conversations. Reply with a title of at most six words for a chat that opens " +
      "with the message below. Reply with the title alone — no quotes, no trailing punctuation, " +
      "no preamble.",
    prompt.slice(0, 2000),
    { signal, onNotice: notice },
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
  const input = preselectInput(catalog, prompt);
  const reply = await ask(endpoint(config), model, PRESELECT_SYSTEM, input, {
    maxTokens: 256,
    signal,
    onNotice: notice,
  });
  const chosen = preselection(parseJson<unknown>(reply), catalog);
  if (chosen.length) console.log(`[agent] preselected: ${chosen.join(", ")}`);
  return chosen;
}

/**
 * How many times a lost request is worth sending again before the turn gives up.
 *
 * Not a setting. min-agent talks to one endpoint, usually on the same machine or the next one
 * over, and the number that would go in that box is the same number for everyone.
 */
const OPEN_RETRIES = 2;

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
    endpoint(config),
    model,
    `Below is a question and the answer it got. Suggest at most ${MAX_FOLLOWUPS} questions the ` +
      "person might sensibly ask next. Each must be specific to what was actually said and " +
      'answerable from here — no generic invitations like "tell me more". Write them as the ' +
      "person would type them, under a dozen words each, one per line, nothing else.",
    `Question:\n${prompt.slice(0, 2000)}\n\nAnswer:\n${reply.slice(0, 6000)}`,
    { maxTokens: 200, signal, onNotice: notice },
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

/**
 * Sends a request, letting `negotiate` answer whatever this endpoint or this model turns out to
 * refuse, and saying what min-agent knows about the one refusal it cannot answer.
 *
 * The memory of what an endpoint and a model have refused — and the loop that answers a refusal
 * by latching it off and sending again — is agent-core's since 2.1.0. What is left here is the
 * overflow: the request was larger than the model will read, so sending it again is the same
 * refusal a round trip later. It goes back in the server's own words with ours added, because
 * the whole difficulty of that failure is that the number the server reports and the window this
 * turn was built to disagree — and the setting that disagrees is one screen away.
 */
export async function sendNegotiated<T>(
  supports: Capabilities,
  model: string,
  contextLimit: number,
  send: (supports: Capabilities) => Promise<T>,
): Promise<T> {
  try {
    return await negotiate(supports, send, {
      model,
      onNotice: notice,
    });
  } catch (error) {
    const detail = errorMessage(error);
    if (!isOverflow(detail)) throw error;
    throw new ContextOverflow(
      contextLimit > 0
        ? `${detail} — this turn was built to ${compactTokens(contextLimit)} tokens, so the window ` +
            "in Settings → Agent is larger than what the server actually serves."
        : `${detail} — set Settings → Agent → Context window, and the turn will compact ` +
            "itself before it gets this far.",
    );
  }
}

export interface RunOptions {
  session: Session;
  prompt: string;
  model?: string;
  onEvent?: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/**
 * Runs one user turn to completion: streams the reply, executes any MCP tool
 * calls, and loops until the model stops asking for tools. Each message is written as it is
 * produced, so a crash mid-run still leaves readable history.
 */
export async function runTurn({ session, prompt, model, onEvent, signal }: RunOptions) {
  const config = loadLlmConfig();
  const chosenModel = model || session.model || config.model;
  if (!chosenModel) throw new Error("No model selected — pick one in Config.");

  const emit = onEvent ?? (() => {});
  const server = endpoint(config);
  const client = getClient(server);
  const supports = capabilitiesFor(server.baseUrl);
  const contextLimit = await contextLimitFor(
    { ...server, model: chosenModel },
    config.contextLimit,
  );

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
  const compactionModel = contextLimit ? modelForTask(config, "compaction") : "";
  const preselectModel = onDemand ? modelForTask(config, "toolSelect") : "";
  const [, preselected = []] = await Promise.all([
    compactionModel
      ? tryAsk(
          "compaction",
          () => compact(session, config, compactionModel, contextLimit, signal),
          { onNotice: notice },
        )
      : undefined,
    preselectModel
      ? tryAsk("preselect", () => preselect(config, preselectModel, catalog, prompt, signal), {
          onNotice: notice,
        })
      : undefined,
  ]);

  session.model = chosenModel;
  session.messages.push({ role: "user", content: prompt });
  // Where this turn begins, so the request can be split into what was already there and what
  // this question added — the tool traffic it goes on to produce lands after it too.
  const turnStart = session.messages.length - 1;
  await addMessage(session.id, session.messages.length - 1, { role: "user", content: prompt });
  for (const name of preselected) loaded.add(name);

  // The truncated first line goes up immediately so the sidebar is never blank, and a model
  // titles it properly in the background if one is configured for the job.
  let titling: Promise<void> | undefined;
  if (session.title === "New chat") {
    session.title = titleFrom(prompt);
    emit({ type: "title", title: session.title });

    const titleModel = modelForTask(config, "title");
    if (titleModel) {
      titling = tryAsk("title", () => generateTitle(config, titleModel, prompt, signal), {
        onNotice: notice,
      }).then(async (title) => {
        if (!title) return;
        session.title = title;
        await updateSession(session.id, { title });
        emit({ type: "title", title });
      });
    }
  }
  await updateSession(session.id, { title: session.title, model: chosenModel });

  const turnUsage = emptyUsage();
  const banked = session.usage ?? emptyUsage();
  const startedAt = Date.now();
  let firstTokenAt = 0;
  let lastTokenAt = 0;
  let toolCalls = 0;
  let iterations = 0;
  let lastRoundTrip = emptyUsage();
  // Measured on the way out, in characters, because nothing on the way back reports it: a
  // completion says how many prompt tokens it read and nothing about where they came from.
  let lastRequest: ContextBreakdown | null = null;
  // Identical call -> identical result. Replaying it from here ends the repeat loops a model
  // falls into when a tool disappoints it, without spending another MCP round trip. What is
  // stored is the in-flight promise rather than the settled string, so two identical calls
  // arriving together in one round trip share a single MCP call instead of racing each other.
  const answered = new Map<string, Promise<string>>();

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
          ? [LOAD_TOOLS_DEFINITION, ...mcp.tools([...loaded])]
          : mcp.tools(),
    );

    const system = routed ? config.systemPrompt : systemPromptFor();
    // Hoisted out of `open` because a rejected request is retried below with the same
    // transcript, and because the split measured from it has to be the one that was sent.
    const history = forApi(session);

    // The tail of the request is this turn's own messages: the question, and whatever the
    // model has done about it so far. `forApi` only ever replaces the head with a summary,
    // so the last n messages of the request are the last n of the session.
    lastRequest = measureRequest({
      system,
      systemPrompt: config.systemPrompt,
      tools: declared,
      history,
      turnLength: session.messages.length - turnStart,
      compacted: Boolean(session.compaction),
    });

    const open = (supports: Capabilities) => {
      const tools = supports.strictSchemas ? declared : relaxTools(declared);
      const takes = modelCapabilitiesFor(supports, chosenModel);
      const effort = config.reasoningEffort;
      return client.chat.completions.create(
        {
          model: chosenModel,
          // Two spellings of one ceiling. `max_tokens` is the one every server understands
          // and the reasoning models are the exception, so it stays the thing we open with.
          ...(takes.legacyTokenLimit
            ? { max_tokens: config.maxTokens }
            : { max_completion_tokens: config.maxTokens }),
          ...(takes.chosenTemperature ? { temperature: config.temperature } : {}),
          // `off` is not a value to send: it is the setting saying leave the field out, which
          // is the only thing a server that has never heard of reasoning will accept.
          ...(effort !== "off" && takes.reasoningEffort ? { reasoning_effort: effort } : {}),
          stream: true,
          ...(supports.usageInStream ? { stream_options: { include_usage: true } } : {}),
          messages: [{ role: "system", content: system }, ...history],
          ...(tools.length ? { tools } : {}),
        },
        { signal },
      );
    };

    /**
     * The negotiated request, sent again when it was lost rather than refused.
     *
     * The two recoveries nest. `negotiate` is the inner one: a capability this endpoint turns
     * out not to have, answered and latched against it for good. This is the outer one — the
     * endpoint being unreachable, busy or silent, which is nothing to do with what the request
     * said and is worth simply waiting out.
     *
     * `getClient` turns the SDK's own retrying off, because a stream that has already produced
     * tokens must never be replayed from the top and the SDK cannot tell whether it has. Here
     * it cannot have: this resolves before the first chunk is read, so a failure at this point
     * is a request that never became an answer. A refusal — a bad schema, an unknown model, a
     * request past the window — is not transient and goes straight out.
     */
    let stream: Awaited<ReturnType<typeof open>>;
    for (let attempt = 0; ; attempt++) {
      try {
        stream = await sendNegotiated(supports, chosenModel, contextLimit, open);
        break;
      } catch (error) {
        if (attempt >= OPEN_RETRIES || !isTransient(error)) throw error;
        const wait = backoffMs(attempt);
        console.warn(`[agent] ${errorMessage(error)}; retrying in ${Math.round(wait)}ms`);
        await sleep(wait, signal);
      }
    }

    iterations++;
    const before = { ...turnUsage };
    let text = "";
    let reasoning = "";
    const calls = new Map<number, { id: string; name: string; args: string }>();

    try {
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
    } catch (error) {
      // Stopping a turn used to throw away everything it had already said: the assistant
      // message is only appended once the stream ends, so an abort left the reply on screen
      // and nothing in the transcript. Keep the part that streamed, then let the error
      // through — the route stays quiet about a turn its reader ended.
      if (signal?.aborted && (text || reasoning)) {
        const partial: StoredMessage = {
          role: "assistant",
          content: text || null,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        };
        session.messages.push(partial);
        await addMessage(session.id, session.messages.length - 1, partial);
      }
      throw error;
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
    const assistantRow = await addMessage(session.id, session.messages.length - 1, assistant);
    await updateSession(session.id, { usage: session.usage });

    if (!roundTripCalls.length) {
      const breakdown = lastRequest
        ? splitContext(lastRequest, lastRoundTrip.promptTokens)
        : undefined;
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
        ...(breakdown ? { breakdown } : {}),
      };
      assistant.stats = stats;
      if (onDemand) session.loadedTools = carryOver(carried, used);
      await titling;
      await patchMessage(assistantRow, { stats });
      if (onDemand) await updateSession(session.id, { loadedTools: session.loadedTools });
      emit({ type: "stats", stats });
      // The turn is over at this point and the reader should not be held by what comes after
      // it, so `done` — the composer's cue to unlock — goes out here rather than once the
      // route returns. The stream stays open a moment longer only so late chips have a way
      // home.
      emit({ type: "done" });

      // After the answer, not before: it is on screen and being read by the time this runs, so
      // the second it costs is spent where nobody is waiting on it. The chips are read back off
      // the stored message too, so they survive a reload without a second delivery path.
      const followupModel = modelForTask(config, "followups");
      const body = typeof assistant.content === "string" ? assistant.content : "";
      if (followupModel && body) {
        const followups = await tryAsk(
          "followups",
          () => suggestFollowups(config, followupModel, prompt, body, signal),
          { onNotice: notice },
        );
        if (followups?.length) {
          assistant.followups = followups;
          await patchMessage(assistantRow, { stats, followups });
          emit({ type: "followups", items: followups });
        }
      }
      return stats;
    }

    // The model asked for these together and they do not depend on each other, so they run
    // together: a round trip now costs the slowest call rather than the sum of all of them.
    // Results are emitted the moment each lands, but appended to the transcript in call order,
    // so what is stored still reads the way the model wrote it.
    const outcomes = await Promise.all(
      roundTripCalls.map(async (call) => {
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
              const inFlight = mcp.call(call.name, args);
              answered.set(key, inFlight);
              // A call that failed is not an answer. Forget it so a retry is a real retry.
              inFlight.catch(() => answered.delete(key));
              content = await inFlight;
            } else {
              content = `${await previous}\n\n(Identical call already made this turn; the result is unchanged. Use it rather than calling again.)`;
            }
          }
        } catch (error) {
          content = errorMessage(error);
          isError = true;
        }
        emit({ type: "tool_result", toolUseId: call.id, content, isError });
        return { id: call.id, content };
      }),
    );

    for (const { id, content } of outcomes) {
      const result: StoredMessage = { role: "tool", tool_call_id: id, content };
      session.messages.push(result);
      await addMessage(session.id, session.messages.length - 1, result);
    }
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
