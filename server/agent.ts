import {
  type AgentLoopResult,
  ask,
  ContextOverflow,
  carryOver,
  clean,
  contextLimitFor,
  type Endpoint,
  failedRun,
  formatTokens,
  isOverflow,
  LOAD_TOOLS_DEFINITION,
  listModels as listEndpointModels,
  listLines,
  PROXY_TOOLS,
  REASONING_CONTENT,
  ReasoningReplay,
  runAgentLoop,
  type SideTask,
  SUMMARY_LEAD,
  sanitizeTools,
  servedWindow,
  serverInstructionsPrompt,
  type ToolCallReport,
  type ToolCallRequest,
  ToolIterationLimit,
  type Turn,
  tryAsk,
  withContext as withContextAt,
} from "@cubicecho/agent-core";
import type { ElicitHandler, ToolDefinition } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import { measureRequest, splitContext } from "../shared/client/usage.ts";
import { MS_PER_SECOND } from "../shared/consts.ts";
import {
  FOLLOWUP_DEFAULTS,
  PRUNING_DEFAULTS,
  TITLE_DEFAULTS,
  TURN_DEFAULTS,
} from "../shared/defaults.ts";
import { messageOf } from "../shared/errors.ts";
import { shownCall } from "../shared/tool-proxy.ts";
import {
  type ContextBreakdown,
  emptyUsage,
  type LlmConfig,
  type ModelInfo,
  modelForTask,
  type ReasoningReplayPolicy,
  type Session,
  type StoredMessage,
  type StreamEvent,
  type TokenUsage,
  type TurnStats,
} from "../shared/types.ts";
import { endpoint, type Settings } from "./config.ts";
import { exchangeHooks, turnIndex, withContext } from "./hooks.ts";
import type { TurnInbox } from "./inbox.ts";
import type { Mcp } from "./mcp.ts";
import {
  LIST_RESOURCES,
  list as listResources,
  READ_RESOURCE,
  RESOURCE_TOOLS,
  type ResourceSource,
  read as readResource,
} from "./mcp-resources.ts";
import { isRemoteAgent } from "./remote-agent.ts";
import type { SessionPatch, Store } from "./store.ts";

/**
 * What a turn talks to outside itself. `server/index.ts` hands in the real ones, and a test its
 * own stand-ins.
 */
export interface TurnDeps {
  /** The MCP servers: their tools, their hooks, their resources and their questions. */
  mcp: Pick<Mcp, "catalog" | "tools" | "call" | "readsOnly" | "hookRunner" | "ask"> &
    ResourceSource;
  /** Where the turn's messages and the chat's own columns are written. */
  store: Pick<Store, "addMessage" | "patchMessage" | "updateSession">;
  /** The settings the turn is run under, read once at its start. */
  settings: Pick<Settings, "current">;
}

/** What the configured endpoint serves, id-sorted, with whatever window it declares. */
export async function listModels(settings: Pick<Settings, "current">): Promise<ModelInfo[]> {
  return listEndpointModels(endpoint(settings.current()));
}

const truncateTitle = (title: string) =>
  title.length > TITLE_DEFAULTS.maxChars ? `${title.slice(0, TITLE_DEFAULTS.keptChars)}…` : title;

function titleFrom(text: string) {
  const line = text.trim().split("\n")[0] ?? "";
  return truncateTitle(line) || "New chat";
}

/**
 * Where agent-core's notices go. It prints nothing on its own — a library that writes to the
 * console picks its consumer's log for it — so anything not handed this is given up on in
 * silence.
 *
 * Worth passing everywhere, because most of what arrives here latches for the life of the
 * process and this line is the only announcement that it did: the loop for the chat model,
 * and the side tasks, which have negotiated their own requests since agent-core 2.1.2. It also
 * carries `runTurn`'s retry notices, so a turn waiting out an endpoint says so while it waits.
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
    prompt.slice(0, TITLE_DEFAULTS.promptChars),
    { signal, onNotice: notice },
  );
  return truncateTitle(clean(reply.split("\n").filter(Boolean).pop() ?? ""));
}

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
    `Below is a question and the answer it got. Suggest at most ${FOLLOWUP_DEFAULTS.maxCount} questions the ` +
      "person might sensibly ask next. Each must be specific to what was actually said and " +
      'answerable from here — no generic invitations like "tell me more". Write them as the ' +
      "person would type them, under a dozen words each, one per line, nothing else.",
    `Question:\n${prompt.slice(0, FOLLOWUP_DEFAULTS.questionChars)}\n\nAnswer:\n${reply.slice(0, FOLLOWUP_DEFAULTS.answerChars)}`,
    { maxTokens: FOLLOWUP_DEFAULTS.maxTokens, signal, onNotice: notice },
  );
  return listLines(text, FOLLOWUP_DEFAULTS.maxCount, FOLLOWUP_DEFAULTS.maxChars);
}

/**
 * The stored rows as the model should see them, for a chat whose transcript has to be rebuilt:
 * one that has not run a turn yet, or one a retry or an edit cut back. Private bookkeeping is
 * stripped, each question is sent with the context its hooks added, and each reply with the
 * thinking `replay` says it carries.
 *
 * `stats` and `followups` are display artifacts, and strict servers reject unknown message
 * fields. The thinking goes back under the field it arrived in: under `all` on every reply that had
 * some, under `tool-loop` only on the calls of the question being answered, and under `none` never
 * — the loop's own rule for what it writes, applied to rows it did not write.
 *
 * A reply with no calls and no text goes as `""` rather than `null`: Ollama refuses the second
 * on every later request, and such a row is what a reply that only thought leaves behind.
 *
 * @param messages The rows, ending before the question about to be asked.
 * @param replay Which replies carry their thinking. agent-core's default when not given.
 */
export function forApi(
  messages: readonly StoredMessage[],
  replay: ReasoningReplayPolicy = ReasoningReplay.All,
): OpenAI.ChatCompletionMessageParam[] {
  // The question being answered: under `tool-loop` only what came after it is its tool loop.
  const question = messages.findLastIndex((message) => message.role === "user");
  return messages.map((message, at) => {
    const {
      reasoning_content,
      reasoning_field,
      reasoning_details,
      stats,
      followups,
      hook_context,
      ...sent
    } = message as StoredMessage;
    if (sent.role === "user") {
      return withContext(sent, hook_context);
    }
    if (sent.role !== "assistant") {
      return sent as OpenAI.ChatCompletionMessageParam;
    }
    const calls = Boolean(sent.tool_calls?.length);
    const replays =
      replay === ReasoningReplay.All ||
      (replay === ReasoningReplay.ToolLoop && calls && at > question);
    return {
      ...sent,
      content: sent.content ?? (calls ? null : ""),
      ...(replays && reasoning_content
        ? { [reasoning_field ?? REASONING_CONTENT]: reasoning_content }
        : {}),
      ...(replays && reasoning_details?.length ? { reasoning_details } : {}),
    };
  });
}

/**
 * A refusal as it should reach the reader: itself, unless it is the one no retry can answer.
 *
 * An overflow is a request larger than the model will read, so sending it again is the same
 * refusal a round trip later. It goes back in the server's own words with ours added, because the
 * whole difficulty of that failure is that the number the server reports and the window this turn
 * was built to disagree — and the setting that disagrees is one screen away.
 *
 * Which of the two is wrong is asked of the server, through agent-core's `servedWindow`: llama.cpp
 * and LM Studio say what a model was actually loaded in, which is the number a listing of its
 * trained window hides. A server that serves less than the turn was built to is said to, with the
 * figure; one that serves at least as much leaves the setting blameless and the refusal as it
 * came, since the turn simply outgrew a window that was right; one that will not say is blamed on
 * the setting as it always was, since that is where the answer is either way.
 *
 * @param contextLimit The window the turn was built to. Zero when none is set.
 * @param server The endpoint and the model the turn ran on, for asking what it serves.
 */
async function withWindow(
  error: unknown,
  contextLimit: number,
  server: Endpoint & { model: string },
): Promise<unknown> {
  const detail = messageOf(error);
  const isOtherFailure = isOverflow(detail) === false;
  if (isOtherFailure) {
    return error;
  }
  if (contextLimit <= 0) {
    return new ContextOverflow(
      `${detail} — set Settings → Agent → Context window, and the turn will compact ` +
        "itself before it gets this far.",
    );
  }
  const served = await servedWindow(server).catch(() => 0);
  if (served >= contextLimit) {
    return error;
  }
  const serves = served > 0 ? ` (${formatTokens(served)})` : "";
  return new ContextOverflow(
    `${detail} — this turn was built to ${formatTokens(contextLimit)} tokens, so the window ` +
      `in Settings → Agent is larger than what the server actually serves${serves}.`,
  );
}

/**
 * An assistant row as it is stored: the reply as the model wrote it, and the thinking with the
 * field it came in, so `forApi` can send it back where the server reads it.
 *
 * The reply is the loop's `written.raw` rather than the message it replays: that one carries the
 * calls' arguments as the loop repaired them, and what is stored is what the model said. The
 * thinking is the turn's, whatever `reasoningReplay` says, because the panel shows it either way
 * and `forApi` decides per request whether it goes back.
 *
 * @param reply What the model wrote, or what a stop cut short, which asked for no calls.
 * @param turn Where the thinking came from. A reply cut short by a stop has only its text, and is
 * stored under `reasoning_content`.
 */
function storedReply(
  { content, tool_calls: calls = [] }: OpenAI.ChatCompletionAssistantMessageParam,
  turn: Pick<Turn, "reasoning" | "reasoningField" | "reasoningDetails">,
): StoredMessage {
  const { reasoning, reasoningField: field, reasoningDetails: details } = turn;
  return {
    role: "assistant",
    content: typeof content === "string" && content ? content : null,
    ...(reasoning ? { reasoning_content: reasoning } : {}),
    ...(reasoning && field && field !== REASONING_CONTENT ? { reasoning_field: field } : {}),
    ...(details?.length ? { reasoning_details: details } : {}),
    // A call with no arguments streams none, and is stored as the `{}` every reader takes it for.
    ...(calls.length
      ? {
          tool_calls: calls.map((call) =>
            call.type === "function"
              ? {
                  ...call,
                  function: { ...call.function, arguments: call.function.arguments || "{}" },
                }
              : call,
          ),
        }
      : {}),
  };
}

/** What a finished turn measured, for `turnStats` to report. */
interface TurnMeasurements {
  /** The loop's own account of the turn: what it cost, how long it took, what it called. */
  result: Pick<AgentLoopResult, "usage" | "turn" | "metrics">;
  /**
   * How long the turn's requests spent streaming once each had begun, summed — the decode time
   * where the server reports none of its own. Zero when nothing streamed.
   */
  streamedMs: number;
  model: string;
  /** The window the turn was built to. Zero when none is set. */
  contextLimit: number;
  breakdown?: TurnStats["breakdown"];
  hooks: NonNullable<TurnStats["hooks"]>;
}

/**
 * The stats stored with a turn's reply, read off the loop's `usage` and `metrics`. A figure is
 * left out rather than reported as zero when the turn has no reading for it: no token streamed,
 * the server sent no usage, no window is set.
 *
 * Throughput is over generation only, so a slow prefill does not drag the rate down: the decode
 * time llama.cpp reports where it does, and otherwise the time each request spent streaming after
 * its first token. Time to first token is the loop's mean over the turn's requests. Loading a
 * definition is bookkeeping, not work the model did for the user, so `load_tools` is not a tool
 * call here.
 */
function turnStats({
  result: { usage, turn, metrics },
  streamedMs,
  model,
  contextLimit,
  breakdown,
  hooks,
}: TurnMeasurements): TurnStats {
  const generationMs = metrics.predictedMs ?? streamedMs;
  const last = turn.usage;
  return {
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    model,
    totalMs: metrics.wallMs ?? 0,
    iterations: metrics.turns,
    toolCalls: metrics.toolCalls - metrics.loadCalls,
    ...(metrics.firstTokenMs !== undefined ? { ttftMs: metrics.firstTokenMs } : {}),
    ...(generationMs > 0
      ? {
          generationMs,
          ...(usage.completionTokens
            ? { tokensPerSecond: usage.completionTokens / (generationMs / MS_PER_SECOND) }
            : {}),
        }
      : {}),
    // The final round trip: what the next turn's context starts from, and the prompt its first
    // request should find cached.
    ...(last.total ? { contextTokens: last.prompt + last.completion } : {}),
    ...(last.prompt ? { lastPromptTokens: last.prompt } : {}),
    ...(contextLimit ? { contextLimit } : {}),
    ...(breakdown ? { breakdown } : {}),
    ...(hooks.length ? { hooks } : {}),
  };
}

type ToolDiscovery = LlmConfig["toolDiscovery"];

export interface RunOptions {
  session: Session;
  prompt: string;
  model?: string;
  onEvent?: (event: StreamEvent) => void;
  signal?: AbortSignal;
  /** What is typed while the turn runs, taken between its steps. Absent takes nothing. */
  inbox?: TurnInbox;
}

type Emit = (event: StreamEvent) => void;

/** Appends to the session and writes the row at the index it landed on, which is its id. */
async function append({ store }: TurnDeps, session: Session, message: StoredMessage) {
  session.messages.push(message);
  return store.addMessage(session.id, session.messages.length - 1, message);
}

/**
 * What is settled about a turn before anything is asked or stored: the model, the window, how
 * tools are discovered and the system prompt. Each is read once and holds for the whole turn.
 */
async function planTurn({ mcp, settings }: TurnDeps, session: Session, model: string | undefined) {
  const config = settings.current();
  const chosenModel = model || session.model || config.model;
  if (!chosenModel) {
    throw new Error("No model selected — pick one in Config.");
  }

  const server = endpoint(config);
  // An agent behind the endpoint runs its own loop: the turn is a thin client of it, and the
  // window, the compaction and the tool loading are the agent's. See `server/remote-agent.ts`.
  const remote = await isRemoteAgent(server, chosenModel);
  const contextLimit = remote
    ? 0
    : await contextLimitFor({ ...server, model: chosenModel }, config.contextLimit);

  // In on-demand mode the model sees a name-only catalogue up front and pulls in the
  // definitions it needs as the turn runs.
  const catalog = mcp.catalog();
  // The setting, except that with nothing to catalogue there is nothing to load on demand, and an
  // agent is sent every tool: a loop's own `load_tools` is a name it will not take as the app's.
  const discovery: ToolDiscovery =
    catalog.length > 0 && remote === false ? config.toolDiscovery : "eager";
  const onDemand = discovery !== "eager";
  // On demand, but with a tool array that never changes: definitions come back as `load_tools`
  // results and run through `call_tool`. The loop's own proxied mode. See `shared/tool-proxy.ts`.
  const proxied = discovery === "proxy";
  // Plain on demand, where what is loaded is declared. See `tools` below.
  const native = discovery === "ondemand";
  // Whether `list_resources` and `read_resource` are worth declaring at all. Read once: a server
  // does not gain the capability mid-turn, and a turn that offers a tool on one step and not the
  // next is a turn the model cannot plan across.
  const offersResources = mcp.resourceServers().length > 0;
  // Nothing is carried when proxied: a definition loaded last turn is already in the transcript,
  // and one a compaction took out has to be loadable again rather than answered "already loaded".
  const carried = proxied ? [] : (session.loadedTools ?? []);
  // The servers' own guidance, as the loop writes it into the request (`serverInstructions`) from
  // the same catalogue: built here as well only so the breakdown can say how much of the system
  // prompt it is, and so what is measured and what was sent are one text.
  const guidance = serverInstructionsPrompt(catalog);
  // What the loop is handed as `system`. On demand and proxied it appends the guidance and then
  // its catalogue, each in its own mode's wording, and both are the same text on every step and
  // every turn: the system prompt is the head of the request, so anything here that moves costs
  // the prompt cache for the whole transcript. What is loaded is said where it does not move the
  // prefix instead — the tool array, and the `load_tools` result.
  const head = config.systemPrompt.trim();
  return {
    config,
    model: chosenModel,
    server,
    remote,
    contextLimit,
    catalog,
    discovery,
    onDemand,
    proxied,
    native,
    offersResources,
    carried,
    guidance,
    head,
  };
}

type TurnPlan = Awaited<ReturnType<typeof planTurn>>;

/**
 * Everything the turn may declare, read once. Discovery is the loop's in every mode: eager it
 * declares `tools`, on demand what is loaded of them, and proxied `load_tools` and `call_tool`,
 * answering a load with the definitions themselves.
 *
 * The resource tools are no server's, so they are the loop's `hostTools`: declared in every mode,
 * never catalogued, loaded, or reached through `call_tool`.
 */
function declaredTools({ mcp }: TurnDeps, { offersResources, proxied }: TurnPlan) {
  const hostTools: ToolDefinition[] = offersResources ? RESOURCE_TOOLS : [];
  const tools: ToolDefinition[] = mcp.tools();
  // As declared, before a server that cannot build a grammar is sent them relaxed: the breakdown
  // has always measured these. Proxied, `load_tools` is the proxy's, worded for `call_tool`.
  const own = proxied ? PROXY_TOOLS : [LOAD_TOOLS_DEFINITION];
  const definitions = new Map(
    [...own, ...hostTools, ...tools].flatMap((tool) =>
      tool.type === "function" ? [[tool.function.name, tool] as const] : [],
    ),
  );
  const hostNames = hostTools.map((tool) => tool.function.name);
  return { hostTools, hostNames, tools, definitions };
}

/**
 * The turn's tool calls: how one is run, and which may run beside the others.
 */
function toolRunner({ mcp }: TurnDeps, session: Session, emit: Emit, signal?: AbortSignal) {
  /**
   * Runs one call and answers with what the model reads. What it throws, the model reads too, in
   * the loop's wording, and the chat's card shows it as a failure.
   *
   * `report.log` goes to the pool as the call's `onLog`, so what a server logs while it runs
   * reaches the chat as a `server-log` event on that call's card — and never the transcript,
   * since it is for the person reading why a call went the way it did, not for the model.
   *
   * `asking` is the call's `onElicit` the same way: a question its server asks while it runs goes
   * on this turn's stream, so it reaches the chat whose turn made the call and nobody else's.
   */
  const dispatch = async (
    { id, name, args }: ToolCallRequest,
    _signal: AbortSignal | undefined,
    report: ToolCallReport,
  ): Promise<string> => {
    const asking: ElicitHandler = (serverId, params, { signal: waiting }) =>
      mcp.ask(
        { sessionId: session.id, toolUseId: id, serverId, server: mcp.labelOf(serverId) },
        params,
        waiting,
        emit,
      );
    if (name === LIST_RESOURCES) {
      return await listResources(mcp);
    }
    if (name === READ_RESOURCE) {
      // Named rather than positional in the schema, so an empty one is a model that filled the
      // call in wrongly — worth saying so, since the uri is the whole of the request.
      const uri = typeof args.uri === "string" ? args.uri.trim() : "";
      if (!uri) {
        throw new Error("read_resource needs a uri; pass the one list_resources gave.");
      }
      return await readResource(mcp, uri);
    }
    return await mcp.call(name, args, signal, report.log, asking);
  };

  /**
   * Whether a call only reads, and so may run beside the turn's other reads and be answered once
   * when the model asks for it twice. The pool answers for a server's tools, from their
   * `readOnlyHint` where the row trusts it; min-agent's own resource tools change nothing. Proxied,
   * the loop has already looked through `call_tool` to the tool it names.
   */
  const reads = ({ name }: ToolCallRequest): boolean =>
    name === LIST_RESOURCES || name === READ_RESOURCE || mcp.readsOnly(name);

  return { dispatch, reads };
}

/**
 * Names a chat that has no name yet. The truncated first line goes up immediately so the sidebar
 * is never blank, and a model titles it properly in the background if one is configured for the
 * job.
 *
 * @returns The background titling, where there is any to wait for.
 */
function startTitle(
  { store }: TurnDeps,
  config: LlmConfig,
  session: Session,
  prompt: string,
  emit: Emit,
  signal?: AbortSignal,
): Promise<void> | undefined {
  if (session.title !== "New chat") {
    return undefined;
  }
  session.title = titleFrom(prompt);
  emit({ type: "title", title: session.title });

  const titleModel = modelForTask(config, "title");
  if (!titleModel) {
    return undefined;
  }
  return tryAsk("title", () => generateTitle(config, titleModel, prompt, signal), {
    onNotice: notice,
  }).then(async (title) => {
    if (!title) {
      return;
    }
    session.title = title;
    await store.updateSession(session.id, { title });
    emit({ type: "title", title });
  });
}

/** What the work after a turn needs of the turn it follows. */
interface AnsweredTurn {
  config: LlmConfig;
  prompt: string;
  /** The reply, and the id of the row it was stored in. */
  assistant: StoredMessage;
  assistantRow: string;
  stats: TurnStats;
  /** The `afterExchange` hooks' failures, once the loop has told them the turn. */
  remembered: AgentLoopResult["afterExchange"];
  emit: Emit;
  signal?: AbortSignal;
}

/**
 * What follows an answered turn, while the reply is already being read: the servers'
 * `afterExchange` hooks and the follow-up suggestions.
 */
async function afterTurn(
  { store }: TurnDeps,
  { config, prompt, assistant, assistantRow, stats, remembered, emit, signal }: AnsweredTurn,
) {
  // Both of these land after the answer and write to the same row. Each write carries everything
  // known at the moment it runs, and they are chained, so the one that finishes second cannot put
  // back a row without the first one's change.
  let writing = Promise.resolve();
  const persist = () => {
    writing = writing.then(() =>
      store.patchMessage(assistantRow, {
        stats,
        ...(assistant.followups ? { followups: assistant.followups } : {}),
      }),
    );
    return writing;
  };

  const body = typeof assistant.content === "string" ? assistant.content : "";
  // The loop told the servers about the turn as it answered. Only a failure is noted, and it is
  // stored with the turn's stats so the line is still there after a reload. Said once it is
  // stored, as the chips are: the turn has settled on the client by now, and what it does with
  // the event is read the stored message back.
  const told = remembered.then(async (notes) => {
    if (!notes.length) {
      return;
    }
    stats.hooks = [...(stats.hooks ?? []), ...notes];
    await persist();
    for (const hook of notes) {
      emit({ type: "hook", hook });
    }
  });

  // After the answer, not before: it is on screen and being read by the time this runs, so the
  // second it costs is spent where nobody is waiting on it. The chips are read back off the
  // stored message too, so they survive a reload without a second delivery path.
  const followupModel = modelForTask(config, "followups");
  if (followupModel && body) {
    const followups = await tryAsk(
      "followups",
      () => suggestFollowups(config, followupModel, prompt, body, signal),
      { onNotice: notice },
    );
    if (followups?.length) {
      assistant.followups = followups;
      await persist();
      emit({ type: "followups", items: followups });
    }
  }
  await told;
}

/**
 * Where the question is in a transcript that ends with it and whatever followed: the user message
 * `steers` before the last one of them, since each message the person typed while the turn ran is
 * a user message after it. A compaction's summary is a user message too, but always ahead of it.
 *
 * @param messages The transcript, the loop's or a request's.
 * @param steers How many typed messages the loop took after the question.
 * @returns The index, or -1 where there is no such message.
 */
function questionAt(messages: readonly OpenAI.ChatCompletionMessageParam[], steers: number) {
  let left = steers;
  for (let at = messages.length - 1; at >= 0; at--) {
    if (messages[at].role === "user" && left-- === 0) {
      return at;
    }
  }
  return -1;
}

/** How a tool result the loop stubbed reads: `[result cleared, 12,345 chars]`. */
const STUB = /^\[result cleared, ([\d,]+) chars\]$/;

/**
 * What the request would have carried on top of what it did, had the tool results the loop
 * stubbed gone whole: each stub's count less the stub itself.
 */
function clearedChars(messages: readonly OpenAI.ChatCompletionMessageParam[]): number {
  let cleared = 0;
  for (const message of messages) {
    const counted =
      message.role === "tool" && typeof message.content === "string"
        ? STUB.exec(message.content)?.[1]
        : undefined;
    if (counted) {
      cleared += Math.max(
        0,
        Number(counted.replaceAll(",", "")) - (message.content as string).length,
      );
    }
  }
  return cleared;
}

/** Whether a message is a compaction's summary, a user message only by its role. */
const isSummary = (message: OpenAI.ChatCompletionMessageParam | undefined) =>
  message?.role === "user" &&
  typeof message.content === "string" &&
  message.content.startsWith(SUMMARY_LEAD);

/** Whether a transcript opens with a compaction's summary, which is where the loop writes one. */
const isCompacted = ([first]: readonly OpenAI.ChatCompletionMessageParam[]) => isSummary(first);

/**
 * The side tasks the loop runs itself, each on the model the settings give it: the summary a
 * compaction writes, and the shortlist of tools a question opens with.
 */
function sideTasks(config: LlmConfig): Record<string, SideTask> {
  const server = endpoint(config);
  const tasks: Record<string, SideTask> = {};
  for (const task of ["compaction", "toolSelect"] as const) {
    const model = modelForTask(config, task);
    if (model) {
      tasks[task] = { model, endpoint: server };
    }
  }
  return tasks;
}

/**
 * Runs one user turn to completion: streams the reply, executes any MCP tool calls, and loops
 * until the model stops asking for tools. Each message is written as it is produced, so a crash
 * mid-run still leaves readable history.
 *
 * The loop is agent-core's, and so is everything around a request: the hooks before and after
 * the question, the shortlist of tools, stubbing old tool results and compacting the transcript
 * as the window fills. What is min-agent's is the two records it keeps of a chat — the rows it
 * shows, appended as the loop writes each message, and the transcript the model was sent, which
 * the next turn continues — and what follows an answer: the stats, the title and the follow-ups.
 */
export async function runTurn(
  { session, prompt, model, onEvent, signal, inbox }: RunOptions,
  deps: TurnDeps,
) {
  const plan = await planTurn(deps, session, model);
  const { config, contextLimit, catalog, discovery, onDemand, native, carried, guidance, head } =
    plan;
  const chosenModel = plan.model;
  const emit = onEvent ?? (() => {});

  // What the model has been sent so far, before the question goes on the end of it. A chat with no
  // transcript of its own has it rebuilt from the rows, which hold every message whole.
  const history = session.transcript ?? forApi(session.messages, config.reasoningReplay);
  // The questions the chat has asked that a compaction took out of the transcript, so the hooks
  // are told the question's place in the chat rather than in what is left of it.
  // The loop leaves a summary out of its count, so it is left out of what is subtracted too.
  const turnBase = Math.max(
    0,
    turnIndex(session.messages) - turnIndex(history.filter((message) => !isSummary(message))),
  );
  const first = session.messages.length === 0;

  session.model = chosenModel;
  const questionIndex = session.messages.length;
  const questionRow = await append(deps, session, { role: "user", content: prompt });
  const { dispatch, reads } = toolRunner(deps, session, emit, signal);

  const titling = startTitle(deps, config, session, prompt, emit, signal);
  await deps.store.updateSession(session.id, { title: session.title, model: chosenModel });

  // The turn's usage is banked once the loop hands back its sum: on its answer, or on what it
  // throws, which carries what the turns before the failure cost.
  const banked = session.usage ?? emptyUsage();
  const bank = async (usage: TokenUsage | undefined, patch: SessionPatch = {}) => {
    session.usage = usage ? add(banked, usage) : session.usage;
    await deps.store.updateSession(session.id, {
      ...(usage ? { usage: session.usage } : {}),
      ...patch,
    });
  };
  let streamedMs = 0;
  // How many messages the person typed while the turn ran, which the loop took after the question.
  let steers = 0;
  // Measured on the way out, in characters, because nothing on the way back reports it: a
  // completion says how many prompt tokens it read and nothing about where they came from.
  let lastRequest: ContextBreakdown | null = null;

  // The calls of the last reply stored, by id: a reply the loop splits into one message per call
  // is stored whole, as the model wrote it, and the pieces after the first are already in it.
  let storedCalls = new Set<string>();
  // The last assistant row written, which the turn's stats are patched onto.
  let assistantRow = "";

  const { hostTools, hostNames, tools, definitions } = declaredTools(deps, plan);
  // An agent's own side tasks are its own, so the loop is given none to run against it.
  const tasks = plan.remote ? {} : sideTasks(config);

  // The calls carded and answered so far, so one told by the loop and by an agent's progress is
  // shown once.
  const carded = new Set<string>();
  const answered = new Set<string>();
  const once = (seen: Set<string>) => (id: string, show: () => void) => {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);
    show();
  };
  const announce = once(carded);
  const answer = once(answered);

  let result: AgentLoopResult;
  try {
    result = await runAgentLoop({
      config: plan.remote
        ? {
            // The agent's sampling is its own: a field its override policy does not let a request
            // set refuses the whole request, and min-agent's settings always hold a value.
            ...plan.server,
            model: chosenModel,
            remoteAgent: true,
            reasoningReplay: config.reasoningReplay,
            maxToolIterations: config.maxToolIterations,
            maxRetries: TURN_DEFAULTS.openRetries,
          }
        : {
            ...plan.server,
            model: chosenModel,
            maxTokens: config.maxTokens,
            temperature: config.temperature,
            reasoningEffort: config.reasoningEffort,
            reasoningReplay: config.reasoningReplay,
            maxToolIterations: config.maxToolIterations,
            toolDiscovery: discovery,
            maxRetries: TURN_DEFAULTS.openRetries,
            // What compaction and pruning plan against, and what each request is sized against
            // before it is sent. None set is none of the three.
            ...(contextLimit > 0 ? { contextLength: contextLimit } : {}),
            tasks,
          },
      // On demand and proxied the loop appends the catalogue itself, after the guidance.
      system: head,
      // Attributed per server and fenced as that server's advice, not the user's: an MCP server is
      // a third party, and this is text it controls landing where a model is most inclined to take
      // it literally.
      serverInstructions: true,
      messages: [...history, { role: "user", content: prompt }],
      ledger: session.ledger,
      tools,
      hostTools,
      catalog,
      // Carried from the last turn, which the loop does not read proxied: a definition loaded
      // there is already in the transcript.
      loaded: carried,
      // The resource tools go first, ahead of `load_tools` and of the proxy's two tools, where they
      // have always been declared; the loop puts its host tools after its own. Everything else
      // stays in the order it was loaded — a load appends, and an array that only grows at its end
      // keeps the prompt cache up to the point it grew. A stable sort, so nothing else moves.
      toolOrder:
        hostNames.length > 0
          ? (a, b) =>
              Number(hostNames.includes(a) === false) - Number(hostNames.includes(b) === false)
          : false,
      // A guess at the tools this question needs, so the chat model opens with them in hand rather
      // than spending a round trip on `load_tools`. Loaded like anything else, at the end, rather
      // than given a first turn of its own that no later turn matches.
      preselect: onDemand && Boolean(tasks.toolSelect),
      preselectRouting: "append",
      // Old tool results stubbed once the window fills, then the head summarised, each only when
      // its own rule says it has earned the cache miss it costs.
      prune: plan.remote
        ? false
        : {
            keepLast: PRUNING_DEFAULTS.keepLast,
            maxChars: PRUNING_DEFAULTS.maxChars,
            minShare: PRUNING_DEFAULTS.windowShare,
          },
      compact: Boolean(tasks.compaction),
      // Reads run together, so a round trip costs the slowest of them rather than the sum, and a
      // read asked for twice in one reply is answered once. Anything else runs alone, in the place
      // the model asked for it, every time it is asked: two writes in one reply would land in
      // whichever order they finished, and the model is then told they happened in its order.
      parallel: reads,
      dedupeToolCalls: reads,
      // A reply that is only a call written as text is still the answer here.
      recoverToolCalls: false,
      signal,
      // The chat's own key, so a long conversation keeps a llama.cpp slot — and the prefix cached
      // in it — from one turn to the next, even while another chat's turn is running.
      session: session.id,
      hooks: exchangeHooks(
        deps.mcp,
        { session: { id: session.id }, prompt, index: turnIndex(session.messages, questionIndex) },
        { first, turnBase, emit },
      ),
      dispatch,
      // What the person typed while the turn ran, taken between its requests and said on the
      // stream as it lands. Stored by `onMessage` below.
      takeInput: inbox
        ? () => {
            const taken = inbox.take();
            if (!taken) {
              return undefined;
            }
            steers++;
            emit({ type: "steer", ids: taken.ids, text: taken.text });
            return { role: "user", content: taken.text };
          }
        : undefined,
      onRequest: (request) => {
        const [opening, ...rest] = request.messages;
        const hasSystem = opening?.role === "system";
        const sent = hasSystem ? rest : request.messages;
        const question = questionAt(sent, steers);
        lastRequest = measureRequest({
          system: hasSystem && typeof opening.content === "string" ? opening.content : "",
          systemPrompt: config.systemPrompt,
          guidance,
          tools: sanitizeTools(
            request.tools.flatMap((tool) =>
              tool.type === "function" ? (definitions.get(tool.function.name) ?? []) : [],
            ),
          ),
          history: [...sent],
          turnLength: question < 0 ? 0 : sent.length - question,
          compacted: isCompacted(sent),
          cleared: clearedChars(sent),
        });
      },
      onEvent: (event) => {
        const { kind, text: delta = "", id, level } = event;
        if (kind === "notice") {
          notice(delta);
        }
        // An agent's own calls, as its progress tells them: carded like the turn's, once each,
        // since the calls it hands back are told by the loop as well.
        const isAgents = "seq" in event && Boolean(id);
        if (isAgents && kind === "tool-call") {
          announce(id as string, () =>
            emit({ type: "tool_use", id: id as string, ...shownCall(event.name ?? "", delta) }),
          );
          return;
        }
        if (isAgents && kind === "tool-result") {
          answer(id as string, () =>
            emit({
              type: "tool_result",
              toolUseId: id as string,
              content: delta,
              isError: event.ok === false,
            }),
          );
          return;
        }
        if (kind === "server-log" && id) {
          emit({ type: "server_log", toolUseId: id, level: level ?? "", text: delta });
          return;
        }
        if (kind !== "thinking" && kind !== "output") {
          return;
        }
        emit({ type: kind === "output" ? "text_delta" : "reasoning_delta", text: delta });
      },
      onToolCall: ({ id, name, raw }) =>
        announce(id, () => emit({ type: "tool_use", id, ...shownCall(name, raw) })),
      onToolResult: ({ id, ok, content }) =>
        answer(id, () =>
          emit({ type: "tool_result", toolUseId: id, content, isError: ok === false }),
        ),
      // Each message is written as it is produced, so a crash mid-run still leaves readable
      // history: the reply before its tools run, every result before the next request.
      onMessage: async (message, _turn, reply, written) => {
        if (message.role === "tool") {
          await append(deps, session, {
            role: "tool",
            tool_call_id: message.tool_call_id,
            content: message.content as string,
          });
          return;
        }
        // The only user message the loop writes: what `takeInput` handed it.
        if (message.role === "user") {
          await append(deps, session, message);
          return;
        }
        if (message.role !== "assistant") {
          return;
        }
        if (!reply || !written) {
          // The loop's own: a call of a reply it split, which the stored reply holds already, or a
          // proxied shortlist's `load_tools`, which nothing the model wrote holds.
          const isStored = message.tool_calls?.every((call) => storedCalls.has(call.id)) ?? false;
          if (isStored === false) {
            await append(deps, session, message as StoredMessage);
          }
          return;
        }

        const { wallMs = 0, firstTokenMs } = reply.usage;
        streamedMs += firstTokenMs === undefined ? 0 : Math.max(0, wallMs - firstTokenMs);
        storedCalls = new Set(reply.toolCalls.map((call) => call.id));
        assistantRow = await append(deps, session, storedReply(written.raw, reply));
      },
    });
  } catch (error) {
    const failure = failedRun(error);
    // Stopping a turn keeps what it had already said: the loop hands the reply in flight back as
    // the failure's `partial`, calls begun left off since nothing will answer them. It goes in the
    // rows and in the transcript both, so what the next turn sends is what the chat shows.
    const partial = failure?.partial;
    const kept =
      signal?.aborted && (partial?.content || partial?.reasoning)
        ? storedReply(
            { role: "assistant", content: partial.content },
            { reasoning: partial.reasoning ?? "" },
          )
        : undefined;
    if (kept) {
      await append(deps, session, kept);
    }
    // The transcript as it stood, to go on from. Without one — a failure from outside the loop —
    // the next turn rebuilds it from the rows.
    session.transcript = failure
      ? [...failure.messages, ...(kept ? forApi([kept], config.reasoningReplay) : [])]
      : undefined;
    session.ledger = failure?.ledger ?? [];
    await bank(failure?.usage, { transcript: session.transcript ?? null, ledger: session.ledger });
    if (error instanceof ToolIterationLimit) {
      throw new Error(error.message);
    }
    // The loop wraps what it caught to hang the run on it. Every message is stored already, so
    // the run is not needed and the error goes on as it was thrown.
    throw await withWindow(failure && error instanceof Error ? error.cause : error, contextLimit, {
      ...plan.server,
      model: chosenModel,
    });
  } finally {
    // The loop takes nothing more, so what is typed from here is the client's to send as a turn.
    inbox?.close();
  }

  if (result.preselected.length) {
    console.log(`[agent] preselected: ${result.preselected.join(", ")}`);
  }
  // The question as it was sent, its hooks' context on it, so the next turn's requests begin with
  // this one's — and the row, so a transcript rebuilt from the rows puts it back too.
  const asked = questionAt(result.messages, steers);
  session.transcript =
    result.context && asked >= 0
      ? withContextAt(result.messages, asked, result.context, result.preface)
      : result.messages;
  session.ledger = result.ledger;
  if (result.context) {
    session.messages[questionIndex].hook_context = result.context;
    await deps.store.patchMessage(questionRow, { hook_context: result.context });
  }
  await bank(result.usage, { transcript: session.transcript, ledger: session.ledger });
  // The loop returns on the turn that asked for no tools, whose reply is the last row written.
  const assistant = session.messages[session.messages.length - 1];
  const breakdown = lastRequest ? splitContext(lastRequest, result.turn.usage.prompt) : undefined;
  const stats = turnStats({
    result,
    streamedMs,
    model: chosenModel,
    contextLimit,
    breakdown,
    hooks: result.notes,
  });
  assistant.stats = stats;
  // What was called, in the order it was loaded, and only what was loaded: a name the model
  // made up is called, and fails, but is nothing to declare next turn.
  if (native) {
    session.loadedTools = carryOver(
      carried,
      new Set(result.loaded.filter((name) => result.used.includes(name))),
    );
  }
  await titling;
  await deps.store.patchMessage(assistantRow, { stats });
  if (native) {
    await deps.store.updateSession(session.id, { loadedTools: session.loadedTools });
  }
  emit({ type: "stats", stats });
  // The turn is over at this point and the reader should not be held by what comes after it, so
  // `done` — the composer's cue to unlock — goes out here rather than once the route returns.
  // The stream stays open a moment longer only so late chips have a way home.
  emit({ type: "done" });

  await afterTurn(deps, {
    config,
    prompt,
    assistant,
    assistantRow,
    stats,
    remembered: result.afterExchange,
    emit,
    signal,
  });
  return stats;
}

const add = (a: TokenUsage | undefined, b: TokenUsage): TokenUsage => ({
  promptTokens: (a?.promptTokens ?? 0) + b.promptTokens,
  completionTokens: (a?.completionTokens ?? 0) + b.completionTokens,
  totalTokens: (a?.totalTokens ?? 0) + b.totalTokens,
});
