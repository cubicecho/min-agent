import {
  type AgentLoopResult,
  applyCompaction,
  ask,
  ContextOverflow,
  carryOver,
  clean,
  compact as compactTokens,
  contextLimitFor,
  type Endpoint,
  expandNames,
  failedRun,
  isOverflow,
  LOAD_TOOLS,
  LOAD_TOOLS_DEFINITION,
  listModels as listEndpointModels,
  listLines,
  loadResult,
  PROXY_TOOLS,
  preselect,
  proxiedCall,
  pruneNotice,
  REASONING_CONTENT,
  ReasoningReplay,
  requestedNames,
  runAgentLoop,
  runCompaction,
  sanitizeTools,
  servedWindow,
  serverInstructionsPrompt,
  summariser,
  type ToolCallReport,
  type ToolCallRequest,
  ToolIterationLimit,
  type Turn,
  type TurnUsage,
  tryAsk,
} from "@cubicecho/agent-core";
import { type ElicitHandler, McpPoolError, type ToolDefinition } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import { measureRequest, splitContext } from "../shared/client/usage.ts";
import { MS_PER_SECOND } from "../shared/consts.ts";
import { FOLLOWUP_DEFAULTS, TITLE_DEFAULTS, TURN_DEFAULTS } from "../shared/defaults.ts";
import { messageOf } from "../shared/errors.ts";
import { CALL_TOOL, shownCall } from "../shared/tool-proxy.ts";
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
import { appendLedger, planFold } from "./compaction.ts";
import { endpoint, type Settings } from "./config.ts";
import {
  compactionHooks,
  type Gathered,
  gather,
  HOST,
  notify,
  turnIndex,
  turnMessages,
  withContext,
} from "./hooks.ts";
import type { Mcp } from "./mcp.ts";
import {
  LIST_RESOURCES,
  list as listResources,
  READ_RESOURCE,
  RESOURCE_TOOLS,
  type ResourceSource,
  read as readResource,
} from "./mcp-resources.ts";
import { clearedChars, planPrune, sentWithStubs } from "./pruning.ts";
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
 * Folds the settled head of a long transcript into a summary, if it has grown far enough into
 * the window to need it. Returns a note for the log; the work is the mutation of `session`.
 *
 * The messages themselves are never deleted — only `compaction.through` moves — so the chat
 * still shows the whole history and the next compaction can build on this summary.
 *
 * Where to cut, the summary and the hooks are agent-core's. What is done with the record is
 * min-agent's: it is stored on the session, and nothing is when there is none.
 */
async function compact(
  { mcp, store }: TurnDeps,
  session: Session,
  config: LlmConfig,
  model: string,
  contextLimit: number,
  signal?: AbortSignal,
): Promise<string> {
  // Whether to fold is decided by what the last turn reported using, which is the server's own
  // count of the request the next one extends. Where to cut is weighed message by message, from
  // the session's ledger where a pair of readings covers them (`planFold`).
  const used = latestCount(session, "contextTokens");
  // No plan when the window is not three quarters used, or no legal cut folds enough.
  const plan = planFold(session, contextLimit, used);
  if (!plan) {
    return "";
  }

  // A memory server gets what is about to be folded away while the summary is written. Beside
  // it, not ahead of it: nothing is deleted, only what is sent changes, so filing it is not a
  // rescue worth making the turn wait for. No record comes back for an empty summary.
  const record = await runCompaction(
    session.messages,
    plan,
    summariser(endpoint(config), model, { signal, onNotice: notice }),
    { hooks: compactionHooks(mcp, session) },
  );
  if (!record) {
    return "";
  }

  session.compaction = record;
  await store.updateSession(session.id, { compaction: record });
  console.log(`[agent] compacted ${record.through} message(s) at ${used}/${contextLimit} tokens`);
  return record.summary;
}

/**
 * Moves the session's pruning marker if the rule says it has earned a move, and says whether it
 * did. See `planPrune` for the rule and `server/pruning.ts` for why there is a marker at all.
 *
 * Stored like a fold: the transcript is not touched, only where `forApi` starts sending tool
 * results whole. A move changes the request from the old marker on, so the caller should expect
 * the next request to miss the prompt cache, once.
 *
 * @param compacted Whether a fold was stored on this turn, which makes a move free.
 */
async function prune(
  { store }: TurnDeps,
  session: Session,
  contextLimit: number,
  compacted = false,
): Promise<boolean> {
  const plan = planPrune(session, contextLimit, { compacted });
  if (!plan) {
    return false;
  }

  const from = session.pruning?.through ?? 0;
  session.pruning = { through: plan.through, at: new Date().toISOString() };
  await store.updateSession(session.id, { pruning: session.pruning });
  console.log(
    `[agent] ${pruneNotice(plan, compacted)}, before message ${plan.through} (was ${from})`,
  );
  return true;
}

/**
 * A count off the last turn that has one. A turn whose server reported no usage is stored with
 * stats and without counts, and is walked past: an older number is a better estimate than none.
 *
 * @param count `lastPromptTokens` is the last turn's final prompt, which the next turn's first
 * request should find cached. `contextTokens` is what the last turn actually cost, which is the
 * best estimate of what the next one will.
 */
function latestCount(session: Session, count: "lastPromptTokens" | "contextTokens"): number {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const counted = session.messages[i].stats?.[count];
    if (counted) {
      return counted;
    }
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
 * The transcript as the server should see it: private bookkeeping stripped, each question sent
 * with the context its hooks added, each reply with the thinking `replay` says it carries, the
 * tool results behind the pruning marker sent as stubs, and — once a session has been compacted —
 * the folded head replaced by its summary.
 *
 * `stats` and `followups` are display artifacts, and strict servers reject unknown message
 * fields. The context is sent on every question that had one, the old as well as the new, so a
 * request is the one before it with only its tail added. See `withContext`.
 *
 * The thinking is decided here rather than left to the loop, because every step is sent this
 * rather than the loop's own transcript: what the loop writes onto its messages never reaches the
 * endpoint, and a row from an earlier turn only ever comes from here. Under `all` it goes back on
 * every reply that had some. Thinking models (gpt-oss, DeepSeek, Qwen3.x, GLM) need theirs back
 * between tool calls, their templates drop what they do not want, and a request whose replies
 * match what was generated keeps the server's prompt cache. Under `tool-loop` it goes back only
 * on the calls of the question being answered, and under `none` never. An endpoint that refuses
 * the field is latched off and sent the request again without it, by the loop.
 *
 * A reply with no calls and no text goes as `""` rather than `null`: Ollama refuses the second
 * on every later request, and such a row is what a reply that only thought leaves behind.
 *
 * The stubs are made here and nowhere else, so the stored rows and the chat keep every result
 * whole. They go in ahead of the fold because the marker, like `compaction.through`, is an index
 * into the stored transcript. See `sentWithStubs`.
 *
 * @param replay Which replies carry their thinking. agent-core's default when not given.
 */
export function forApi(
  session: Session,
  replay: ReasoningReplayPolicy = ReasoningReplay.All,
): OpenAI.ChatCompletionMessageParam[] {
  // `from: 0` because the system prompt is a separate argument and never in the transcript:
  // the summary is the request's first message, with nothing kept ahead of it.
  const messages = applyCompaction(
    sentWithStubs(session.messages, session.pruning),
    session.compaction,
    { from: 0 },
  );
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
  const serves = served > 0 ? ` (${compactTokens(served)})` : "";
  return new ContextOverflow(
    `${detail} — this turn was built to ${compactTokens(contextLimit)} tokens, so the window ` +
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
}

type Emit = (event: StreamEvent) => void;

/** What the servers' hooks are told about a turn, before it and after it. */
interface TurnHookContext {
  session: { id: string };
  host: string;
  prompt: string;
  turn: { index: number };
}

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
  const contextLimit = await contextLimitFor(
    { ...server, model: chosenModel },
    config.contextLimit,
  );

  // In on-demand mode the model sees a name-only catalogue up front and pulls in the
  // definitions it needs as the turn runs.
  const catalog = mcp.catalog();
  // The setting, except that with nothing to catalogue there is nothing to load on demand.
  const discovery: ToolDiscovery = catalog.length > 0 ? config.toolDiscovery : "eager";
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
  // Nothing is carried when proxied: a definition loaded last turn is already in the history, and
  // one a compaction folded away has to be loadable again rather than answered "already loaded".
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
  // Whether the request opens with a system message of the loop's. With none, an empty one is
  // sent all the same, as it always was; see `transcript` in `runTurn`.
  const hasSystem = Boolean(head || guidance || onDemand);
  return {
    config,
    model: chosenModel,
    server,
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
    hasSystem,
  };
}

type TurnPlan = Awaited<ReturnType<typeof planTurn>>;

/**
 * Everything the turn may declare, read once. Discovery is the loop's in every mode: eager it
 * declares `tools`, on demand what is loaded of them, and proxied `load_tools` and `call_tool`,
 * answering a load with the definitions themselves.
 *
 * The resource tools are no server's, so they are the loop's `hostTools`: declared in every mode,
 * never catalogued, loaded, or reached through `call_tool`. `call_tool` is listed on demand so that
 * it stays the host's there — a chat switched out of proxied mode still has it in its history —
 * answered here, where it does not load or carry what it names.
 */
function declaredTools({ mcp }: TurnDeps, { offersResources, proxied, native }: TurnPlan) {
  const hostTools: ToolDefinition[] = offersResources ? RESOURCE_TOOLS : [];
  const callTool = PROXY_TOOLS.filter(
    (tool): tool is ToolDefinition => tool.type === "function" && tool.function.name === CALL_TOOL,
  );
  const tools: ToolDefinition[] = [...(native ? callTool : []), ...mcp.tools()];
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
 * The turn's tool calls and what they leave behind: which calls failed.
 */
function toolRunner(
  { mcp }: TurnDeps,
  { catalog, native, carried }: TurnPlan,
  session: Session,
  emit: Emit,
  signal?: AbortSignal,
) {
  // What a `load_tools` answered here has loaded, for its "already loaded". On demand and proxied
  // the loop answers loads and keeps its own; a load reaches here only eager, where a model copies
  // the call out of an on-demand chat's history.
  const loaded = new Set(carried);
  // Identical call -> identical result, for the turn. See `callOnce`.
  const answered = new Map<string, Promise<string>>();
  // Calls `dispatch` answered with a failure. It answers rather than throws; see below.
  const failed = new Set<string>();

  /**
   * Runs one call and answers with what the model reads — a failure included, which is noted in
   * `failed` rather than thrown. The loop rethrows what a dispatcher throws once the turn has
   * been stopped, and a call the stop ended has an answer worth keeping: which call it was, and
   * that it did not finish.
   *
   * Arguments the loop had to repair to read are refused, in the model's own words. The loop
   * reads almost-JSON — single quotes, a trailing comma, JSON inside a string — and says so in
   * `repaired`; min-agent tells the model its arguments were not JSON and has it write them again,
   * and that is not the loop's to change. A proxied `call_tool` arrives as the tool it names, with
   * `repaired` saying whether the `call_tool`'s own arguments took a repair.
   *
   * `report.log` goes to the pool as the call's `onLog`, so what a server logs while it runs
   * reaches the chat as a `server-log` event on that call's card — and never the transcript,
   * since it is for the person reading why a call went the way it did, not for the model.
   *
   * `asking` is the call's `onElicit` the same way: a question its server asks while it runs goes
   * on this turn's stream, so it reaches the chat whose turn made the call and nobody else's.
   */
  const dispatch = async (
    { id, name: called, args, raw, repaired }: ToolCallRequest,
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
    try {
      if (repaired) {
        throw new Error(
          `model produced invalid tool arguments: ${raw.slice(0, TURN_DEFAULTS.quotedArgumentChars)}`,
        );
      }
      // Reached only eager, where a model copies the call out of an on-demand chat's history:
      // on demand and proxied, the loop answers its own loads.
      if (called === LOAD_TOOLS) {
        const resolved = expandNames(requestedNames(args), catalog);
        // What was loaded before this call, so a repeat load is answered "already loaded"
        // rather than as fresh — the model's cue to call the tool instead of loading again.
        const before = new Set(loaded);
        for (const name of resolved.matched) {
          loaded.add(name);
        }
        if (resolved.matched.length === 0) {
          failed.add(id);
        }
        return loadResult(resolved, catalog, before);
      }
      if (native && called === CALL_TOOL) {
        // Plain on demand, where `call_tool` is the host's: a chat switched out of proxied mode
        // still has it in its history, and the model may copy it. Proxied, the loop looks
        // through it and this is handed the tool it names.
        const { name, input } = proxiedCall(args, catalog);
        return await callOnce(answered, `${name}\u0000${JSON.stringify(input)}`, () =>
          mcp.call(name, input, signal, report.log, asking),
        );
      }
      if (called === LIST_RESOURCES) {
        return await listResources(mcp);
      }
      if (called === READ_RESOURCE) {
        // Named rather than positional in the schema, so an empty one is a model that filled
        // the call in wrongly — worth saying so, since the uri is the whole of the request.
        const uri = typeof args.uri === "string" ? args.uri.trim() : "";
        if (!uri) {
          throw new Error("read_resource needs a uri; pass the one list_resources gave.");
        }
        return await readResource(mcp, uri);
      }
      return await callOnce(answered, `${called}\u0000${raw}`, () =>
        mcp.call(called, args, signal, report.log, asking),
      );
    } catch (error) {
      failed.add(id);
      return messageOf(error);
    }
  };

  /**
   * Whether a call only reads, and so may run beside the step's other reads. The pool answers for
   * a server's tools, from their `readOnlyHint` where the row trusts it. min-agent's own tools —
   * a load, a resource listing or read — change nothing a write could see. A `call_tool` on demand
   * is asked about the tool it names; proxied, the loop has already looked through it. One that
   * names nothing readable is a barrier, and is refused on its turn anyway.
   */
  const reads = ({ name, args }: ToolCallRequest): boolean => {
    if (name === LOAD_TOOLS || name === LIST_RESOURCES || name === READ_RESOURCE) {
      return true;
    }
    if (native && name === CALL_TOOL) {
      try {
        return mcp.readsOnly(proxiedCall(args, catalog).name);
      } catch {
        return false;
      }
    }
    return mcp.readsOnly(name);
  };

  return { dispatch, reads, failed };
}

/**
 * What has to land before the question is stored: the fold, the shortlist of tools, the hooks'
 * context and the pruning marker.
 *
 * @returns The shortlist, what the hooks gathered, and whether the head of the request moved,
 * in which case the first request is not expected to find the last turn's prompt cached.
 */
async function settleHistory(
  deps: TurnDeps,
  { config, contextLimit, onDemand, catalog }: TurnPlan,
  session: Session,
  prompt: string,
  hookContext: TurnHookContext,
  emit: Emit,
  signal?: AbortSignal,
) {
  // Two small-model calls and the hooks have to land before the first token is asked for, and
  // none depends on another, so they overlap. Compaction goes before the user's message is
  // appended, so the summary covers settled history and the question that prompted it stays
  // verbatim. A session's first turn is also its start.
  // Read before a compaction can move it: a fold rewrites the history, and the miss after one is
  // expected rather than worth a warning.
  const foldedThrough = session.compaction?.through;
  const compactionModel = contextLimit ? modelForTask(config, "compaction") : "";
  const preselectModel = onDemand ? modelForTask(config, "toolSelect") : "";
  const [, preselected = [], gathered] = await Promise.all([
    compactionModel
      ? tryAsk(
          "compaction",
          () => compact(deps, session, config, compactionModel, contextLimit, signal),
          { onNotice: notice },
        )
      : undefined,
    // A guess at the tools this request needs, so the chat model opens with them in hand rather
    // than spending a round trip on `load_tools`. agent-core's, which holds the reply to a schema
    // and gives up to an empty list on its own — a stop excepted, which still ends the turn.
    preselectModel
      ? preselect(endpoint(config), preselectModel, catalog, prompt, { signal, onNotice: notice })
      : undefined,
    gather(
      deps.mcp,
      session.messages.length === 0 ? ["sessionStart", "beforeTurn"] : ["beforeTurn"],
      hookContext,
      { signal, emit },
    ),
  ]);
  if (preselected.length) {
    console.log(`[agent] preselected: ${preselected.join(", ")}`);
  }
  // After the fold rather than beside it, because a fold makes this free: the head of the request
  // has just been rewritten, so the miss a move costs is already being paid. And before the
  // question, for compaction's reason — what is cleared is settled history.
  const prunedAtStart = await prune(
    deps,
    session,
    contextLimit,
    session.compaction?.through !== foldedThrough,
  );
  const folded = session.compaction?.through !== foldedThrough;
  return { preselected, gathered, headMoved: folded || prunedAtStart };
}

/**
 * Stores the question.
 *
 * @returns The index of the question, which is where this turn begins.
 */
async function askQuestion(
  deps: TurnDeps,
  session: Session,
  prompt: string,
  context: Gathered["context"],
) {
  const question: StoredMessage = {
    role: "user",
    content: prompt,
    ...(context ? { hook_context: context } : {}),
  };
  await append(deps, session, question);
  // Where this turn begins, so the request can be split into what was already there and what
  // this question added — the tool traffic it goes on to produce lands after it too. Proxied, the
  // shortlist goes after it as well: the loop writes it into the history as a `load_tools`
  // exchange, since the tool array has nowhere to put it.
  return session.messages.length - 1;
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
  session: Session;
  prompt: string;
  /** The reply, and the id of the row it was stored in. */
  assistant: StoredMessage;
  assistantRow: string;
  stats: TurnStats;
  hookContext: TurnHookContext;
  turnStart: number;
  emit: Emit;
  signal?: AbortSignal;
}

/**
 * What follows an answered turn, while the reply is already being read: the servers' `afterTurn`
 * hooks and the follow-up suggestions.
 */
async function afterTurn(
  { mcp, store }: TurnDeps,
  {
    config,
    session,
    prompt,
    assistant,
    assistantRow,
    stats,
    hookContext,
    turnStart,
    emit,
    signal,
  }: AnsweredTurn,
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
  // The turn is answered, so the servers are told about it. Only a failure is noted, and it is
  // stored with the turn's stats so the line is still there after a reload. Said once it is
  // stored, as the chips are: the turn has settled on the client by now, and what it does with
  // the event is read the stored message back.
  const remembered = notify(mcp, "afterTurn", {
    ...hookContext,
    reply: body,
    turn: { ...hookContext.turn, messages: turnMessages(session, turnStart) },
  }).then(async (notes) => {
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
  await remembered;
}

/**
 * Runs one user turn to completion: streams the reply, executes any MCP tool
 * calls, and loops until the model stops asking for tools. Each message is written as it is
 * produced, so a crash mid-run still leaves readable history.
 */
export async function runTurn(
  { session, prompt, model, onEvent, signal }: RunOptions,
  deps: TurnDeps,
) {
  const plan = await planTurn(deps, session, model);
  const { config, contextLimit, catalog, discovery, native, carried, guidance, head, hasSystem } =
    plan;
  const chosenModel = plan.model;
  const emit = onEvent ?? (() => {});

  // What the servers' hooks are told about this turn. The index is counted before the question
  // is appended, so it is this turn's own.
  const hookContext = {
    session: { id: session.id },
    host: HOST,
    prompt,
    turn: { index: turnIndex(session.messages) },
  };

  const { preselected, gathered, headMoved } = await settleHistory(
    deps,
    plan,
    session,
    prompt,
    hookContext,
    emit,
    signal,
  );

  session.model = chosenModel;
  const turnStart = await askQuestion(deps, session, prompt, gathered.context);
  const { dispatch, reads, failed } = toolRunner(deps, plan, session, emit, signal);

  const titling = startTitle(deps, config, session, prompt, emit, signal);
  await deps.store.updateSession(session.id, { title: session.title, model: chosenModel });

  // The turn's usage is banked once the loop hands back its sum: on its answer, or on what it
  // throws, which carries what the steps before the failure cost.
  const banked = session.usage ?? emptyUsage();
  const bank = async (usage: TokenUsage | undefined, patch: SessionPatch = {}) => {
    if (!usage) {
      return;
    }
    session.usage = add(banked, usage);
    await deps.store.updateSession(session.id, { usage: session.usage, ...patch });
  };
  let streamedMs = 0;
  // Measured on the way out, in characters, because nothing on the way back reports it: a
  // completion says how many prompt tokens it read and nothing about where they came from.
  let lastRequest: ContextBreakdown | null = null;
  // The turn before's last prompt, which the first step should find cached. The loop holds every
  // later step to the one before it (`cacheBroken`), but it cannot see a request from before it
  // began, so this one comparison is min-agent's — unless a compaction just rewrote the history
  // under it, or the pruning marker moved and turned results it had sent whole into stubs.
  const lastTurnPrompt = headMoved ? 0 : latestCount(session, "lastPromptTokens");
  // Whether the marker moved ahead of this step, which the loop reads as a history rewritten: a
  // miss the request is expected to make, and nothing to warn about.
  let prunedBeforeStep = false;
  let previousPrompt = lastTurnPrompt;
  /**
   * Says so when a request found much less of the last one cached than it should have. Nothing
   * min-agent sends moves a prefix it sent before, a compaction or a move of the pruning marker
   * aside, so such a request is the server's doing — an eviction, a side task on the same slot —
   * or a prefix that moved anyway. Only where the server said what it cached.
   *
   * @param usage The step's own report, with the loop's diagnosis on it from the second step on.
   * @param previous The prompt the request before it reported.
   * @param step Which step of the turn this is.
   */
  const warnOnCacheMiss = (usage: TurnUsage, previous: number, step: number) => {
    const missed =
      step === 0
        ? usage.uncached !== undefined && usage.cached < previous * TURN_DEFAULTS.cachedShare
        : usage.cacheBroken === true && prunedBeforeStep === false;
    if (!missed) {
      return;
    }
    const why = step > 0 && usage.cacheBreakReason ? ` (${usage.cacheBreakReason})` : "";
    console.warn(
      `[agent] prompt cache missed: ${usage.cached} of ${usage.prompt} cached, ` +
        `after a ${previous}-token request${why}`,
    );
  };
  // The marker's check between tool steps, which is where a long turn needs it: nothing compacts
  // mid-turn, and a turn of thirty tool calls is thirty results replayed whole on every step. Owed
  // from the moment a step's last result is stored, and paid before the next request or, where
  // the turn ends there instead — the iteration cap, a stop — on the way out: `beforeStep` is not
  // called after the last step. A move is a miss the next request is expected to make, so it is
  // not held to the last one's prompt.
  let pruneOwed = false;
  const pruneBetweenSteps = async () => {
    if (pruneOwed === false) {
      return;
    }
    pruneOwed = false;
    prunedBeforeStep = await prune(deps, session, contextLimit);
  };

  // The calls of the last reply stored, by id: a reply the loop splits into one message per call
  // is stored whole, as the model wrote it, and the pieces after the first are already in it.
  let storedCalls = new Set<string>();
  // The last assistant row written, which the turn's stats are patched onto.
  let assistantRow = "";
  // How many of the step's calls have no result stored yet.
  let unanswered = 0;

  // The transcript is the session's, not the loop's: `forApi` strips what is private, sends each
  // question with its hooks' context and the pruned results as stubs, and replaces a folded head
  // with its summary. So every step is handed it afresh, and the loop's own copy — which carries
  // repaired arguments where the stored row has the model's own — is never what is sent.
  //
  // An empty system prompt is still sent as a message, as it always was; the loop leaves one out.
  const transcript = (): OpenAI.ChatCompletionMessageParam[] => {
    const history = forApi(session, config.reasoningReplay);
    return hasSystem ? history : [{ role: "system", content: "" }, ...history];
  };

  const { hostTools, hostNames, tools, definitions } = declaredTools(deps, plan);

  let result: AgentLoopResult;
  try {
    result = await runAgentLoop({
      // No `contextLength`, on purpose: the loop would size each request against it and refuse
      // one here rather than a round trip later, and min-agent's is the *configured* window,
      // which `withWindow` exists to say may be larger than what the server serves. A guard read
      // off the number under suspicion would refuse turns for the wrong reason.
      config: {
        ...plan.server,
        model: chosenModel,
        maxTokens: config.maxTokens,
        temperature: config.temperature,
        reasoningEffort: config.reasoningEffort,
        // `forApi` applies it to what is sent; the loop is told so its own transcript agrees.
        reasoningReplay: config.reasoningReplay,
        maxToolIterations: config.maxToolIterations,
        toolDiscovery: discovery,
        maxRetries: TURN_DEFAULTS.openRetries,
      },
      // On demand and proxied the loop appends the catalogue itself, after the guidance.
      system: head,
      // Attributed per server and fenced as that server's advice, not the user's: an MCP server is
      // a third party, and this is text it controls landing where a model is most inclined to take
      // it literally.
      serverInstructions: true,
      messages: transcript(),
      tools,
      hostTools,
      catalog,
      // Carried from the last turn, which the loop does not read proxied: a definition loaded
      // there is already in the history.
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
      // The same head on every step, the first included: the shortlist is loaded like anything
      // else, at the end, rather than given a first step of its own that no later step matches.
      // Proxied, the loop writes it after the question as a `load_tools` exchange instead.
      preselected,
      preselectRouting: "append",
      // Reads run together, so a round trip costs the slowest of them rather than the sum. Anything
      // else runs alone, in the place the model asked for it: two writes in one reply would land
      // in whichever order they finished, and the model is then told they happened in its order.
      parallel: reads,
      // `callOnce` instead: for the turn rather than the step, and with a note on the repeat.
      dedupeToolCalls: false,
      // A reply that is only a call written as text is still the answer here.
      recoverToolCalls: false,
      signal,
      // The chat's own key, so a long conversation keeps a llama.cpp slot — and the prefix cached
      // in it — from one turn to the next, even while another chat's turn is running.
      session: session.id,
      dispatch,
      beforeStep: async (_sent, step) => {
        if (step === 0) {
          return undefined;
        }
        await pruneBetweenSteps();
        return transcript();
      },
      onRequest: (request) => {
        // The request opens with a system message every time — the loop's, or the empty one
        // `transcript` sends — and the rest is the history as it went out.
        const [opening, ...history] = request.messages;
        // The tail of the request is this turn's own messages: the question, and whatever the
        // model has done about it so far. `forApi` only ever replaces the head with a summary,
        // so the last n messages of the request are the last n of the session.
        lastRequest = measureRequest({
          system: typeof opening?.content === "string" ? opening.content : "",
          systemPrompt: config.systemPrompt,
          guidance,
          tools: sanitizeTools(
            request.tools.flatMap((tool) =>
              tool.type === "function" ? (definitions.get(tool.function.name) ?? []) : [],
            ),
          ),
          history,
          turnLength: session.messages.length - turnStart,
          compacted: Boolean(session.compaction),
          cleared: clearedChars(session),
        });
      },
      onEvent: ({ kind, text: delta = "", id, level }) => {
        if (kind === "notice") {
          notice(delta);
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
      onToolCall: ({ id, name, raw }) => emit({ type: "tool_use", id, ...shownCall(name, raw) }),
      onToolResult: ({ id, ok, content }) =>
        emit({
          type: "tool_result",
          toolUseId: id,
          content,
          isError: ok === false || failed.has(id),
        }),
      // Each message is written as it is produced, so a crash mid-run still leaves readable
      // history: the reply before its tools run, every result before the next request.
      onMessage: async (message, step, turn, written) => {
        if (message.role === "tool") {
          await append(deps, session, {
            role: "tool",
            tool_call_id: message.tool_call_id,
            content: message.content as string,
          });
          if (--unanswered === 0) {
            pruneOwed = true;
          }
          return;
        }
        if (message.role !== "assistant") {
          return;
        }
        if (!turn || !written) {
          // The loop's own: a call of a reply it split, which the stored reply holds already, or a
          // proxied shortlist's `load_tools`, which nothing the model wrote holds.
          const isStored = message.tool_calls?.every((call) => storedCalls.has(call.id)) ?? false;
          if (isStored === false) {
            await append(deps, session, message as StoredMessage);
          }
          return;
        }

        warnOnCacheMiss(turn.usage, step === 0 ? lastTurnPrompt : previousPrompt, step);
        previousPrompt = turn.usage.prompt;
        prunedBeforeStep = false;
        const { wallMs = 0, firstTokenMs } = turn.usage;
        streamedMs += firstTokenMs === undefined ? 0 : Math.max(0, wallMs - firstTokenMs);

        unanswered = turn.toolCalls.length;
        storedCalls = new Set(turn.toolCalls.map((call) => call.id));
        assistantRow = await append(deps, session, storedReply(written.raw, turn));
      },
    });
  } catch (error) {
    // What the steps before the failure reported is kept, as an answered turn's is, and before a
    // partial reply is stored below: the loop's transcript ends where the stored one does.
    const failure = failedRun(error);
    const measured = failure?.ledger?.length ? failure.ledger : undefined;
    if (failure && measured) {
      session.ledger = appendLedger(session, failure.messages, measured);
    }
    await bank(failure?.usage, measured ? { ledger: session.ledger } : {});
    await pruneBetweenSteps();
    // Stopping a turn used to throw away everything it had already said: the assistant message
    // is only appended once the stream ends, so an abort left the reply on screen and nothing in
    // the transcript. Keep the part that streamed — the loop hands it back as the failure's
    // `partial`, calls begun left off since nothing will answer them — then let the error
    // through. The route stays quiet about a turn its reader ended.
    const partial = failure?.partial;
    if (signal?.aborted && (partial?.content || partial?.reasoning)) {
      await append(
        deps,
        session,
        storedReply(
          { role: "assistant", content: partial.content },
          { reasoning: partial.reasoning ?? "" },
        ),
      );
    }
    if (error instanceof ToolIterationLimit) {
      throw new Error(error.message);
    }
    // The loop wraps what it caught to hang the run on it. Every message is stored already, so
    // the run is not needed and the error goes on as it was thrown.
    throw await withWindow(failure && error instanceof Error ? error.cause : error, contextLimit, {
      ...plan.server,
      model: chosenModel,
    });
  }

  // What the turn's requests reported, kept for the next fold to weigh the messages by.
  session.ledger = appendLedger(session, result.messages, result.ledger);
  await bank(result.usage, { ledger: session.ledger });
  // The loop returns on the step that asked for no tools, whose reply is the last row written.
  const assistant = session.messages[session.messages.length - 1];
  const breakdown = lastRequest ? splitContext(lastRequest, result.turn.usage.prompt) : undefined;
  const stats = turnStats({
    result,
    streamedMs,
    model: chosenModel,
    contextLimit,
    breakdown,
    hooks: gathered.notes,
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
    session,
    prompt,
    assistant,
    assistantRow,
    stats,
    hookContext,
    turnStart,
    emit,
    signal,
  });
  return stats;
}

/** A tool that ran and failed, as opposed to a call that could not be made. */
const isToolError = (error: unknown) =>
  error instanceof McpPoolError && error.code === "tool-error";

/**
 * Makes a tool call at most once per turn for the same name and arguments, replaying the answer
 * to a repeat. A model that a tool disappoints often asks again, word for word, and replaying the
 * answer with a note ends that loop without spending another MCP round trip.
 *
 * The in-flight promise is what is kept rather than the settled string, so two identical calls in
 * one round trip share a single MCP call instead of racing each other.
 *
 * A call that could not be made is not an answer: a server in backoff, a connect that failed, a
 * timeout, a stop. It is forgotten so a retry is a real retry. A tool that ran and rejected its
 * arguments *is* an answer — the same arguments get the same one — so it is kept and replayed like
 * a result. Telling the two apart is what the pool's `tool-error` code is for.
 *
 * @param answered The turn's calls so far, by `key`.
 * @param key The tool's name and its raw arguments.
 * @param run Makes the call, when it has not been made.
 */
export async function callOnce(
  answered: Map<string, Promise<string>>,
  key: string,
  run: () => Promise<string>,
): Promise<string> {
  const previous = answered.get(key);
  if (previous === undefined) {
    const inFlight = run();
    answered.set(key, inFlight);
    inFlight.catch((error: unknown) => {
      const isTransient = isToolError(error) === false;
      if (isTransient) {
        answered.delete(key);
      }
    });
    return inFlight;
  }
  try {
    return `${await previous}\n\n(Identical call already made this turn; the result is unchanged. Use it rather than calling again.)`;
  } catch (error) {
    // Only a tool's own rejection is certain to repeat. Anything else reached this caller because
    // it was sharing a call still in flight, and is forgotten already.
    const isTransient = isToolError(error) === false;
    if (isTransient) {
      throw error;
    }
    throw new Error(
      `${messageOf(error)}\n\n(Identical call already failed this turn; it will fail the same way again. Change the arguments or try something else.)`,
    );
  }
}

const add = (a: TokenUsage | undefined, b: TokenUsage): TokenUsage => ({
  promptTokens: (a?.promptTokens ?? 0) + b.promptTokens,
  completionTokens: (a?.completionTokens ?? 0) + b.completionTokens,
  totalTokens: (a?.totalTokens ?? 0) + b.totalTokens,
});
