import type {
  ContextBreakdown,
  LlmConfig,
  StoredMessage,
  TokenUsage,
  TurnStats,
} from "../types.ts";

type Pricing = LlmConfig["pricing"];

function compact(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

/** Null when no prices are configured — local models have no meaningful cost. */
export function costOf(usage: TokenUsage, pricing?: Pricing): number | null {
  if (!pricing?.inputPer1M && !pricing?.outputPer1M) return null;
  const input = (usage.promptTokens * (pricing?.inputPer1M ?? 0)) / 1_000_000;
  const output = (usage.completionTokens * (pricing?.outputPer1M ?? 0)) / 1_000_000;
  return input + output;
}

export function formatUsage(usage: TokenUsage, pricing?: Pricing): string {
  const tokens = `${compact(usage.totalTokens)} tokens`;
  const cost = costOf(usage, pricing);
  if (cost === null) return tokens;
  return `${tokens} · ${cost > 0 && cost < 0.01 ? "<$0.01" : `$${cost.toFixed(2)}`}`;
}

/** "1,024 in · 512 out" — the breakdown behind the total. */
export const usageDetail = (usage: TokenUsage) =>
  `${usage.promptTokens.toLocaleString()} in · ${usage.completionTokens.toLocaleString()} out`;

/** Short token count: "187", "12.4k", "1.2M". */
export const formatTokens = compact;

/** "340ms", "4.6s", "1m 04s" — durations a human reads at a glance. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${String(Math.round((ms % 60_000) / 1000)).padStart(2, "0")}s`;
}

export const formatRate = (tokensPerSecond: number) => `${tokensPerSecond.toFixed(1)} tok/s`;

/**
 * The per-turn stats line, as pieces to join. Anything the server did not report is
 * simply left out rather than shown as a zero.
 */
export function statsLine(stats: TurnStats, pricing?: Pricing): string[] {
  const parts: string[] = [];
  if (stats.completionTokens) parts.push(`${compact(stats.completionTokens)} out`);
  if (stats.tokensPerSecond) parts.push(formatRate(stats.tokensPerSecond));
  if (stats.ttftMs !== undefined) parts.push(`${formatDuration(stats.ttftMs)} to first token`);
  parts.push(formatDuration(stats.totalMs));
  if (stats.toolCalls) parts.push(`${stats.toolCalls} tool${stats.toolCalls === 1 ? "" : "s"}`);
  if (stats.iterations > 1) parts.push(`${stats.iterations} rounds`);
  // A single turn usually costs well under a cent, so this readout goes finer than the
  // session total's "<$0.01".
  const cost = costOf(stats, pricing);
  if (cost) parts.push(`$${cost.toFixed(cost < 0.01 ? 4 : 2)}`);
  return parts;
}

/** How full the model's context window is after a turn, or null when either side is unknown. */
export function contextFill(stats?: TurnStats | null) {
  if (!stats?.contextTokens || !stats.contextLimit) return null;
  const ratio = Math.min(stats.contextTokens / stats.contextLimit, 1);
  return {
    used: stats.contextTokens,
    limit: stats.contextLimit,
    ratio,
    label: `${compact(stats.contextTokens)} / ${compact(stats.contextLimit)}`,
    percent: `${(ratio * 100).toFixed(ratio < 0.1 ? 1 : 0)}%`,
  };
}

/** The stats of the most recent completed turn in a stored session. */
export function latestStats(messages: StoredMessage[]): TurnStats | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const stats = messages[index]?.stats;
    if (stats) return stats;
  }
  return null;
}

/* --------------------------------------------------------------- context split */

/**
 * Fixed, so the bar and the rows do not reorder themselves as a conversation grows, and in
 * the order the request is built: the standing overhead first, then what the conversation has
 * put on top of it, then this turn.
 */
const PARTS = [
  "system",
  "catalogue",
  "tools",
  "summary",
  "history",
  "historyTools",
  "input",
  "inputTools",
] as const;

export const BREAKDOWN_LABEL: Record<keyof ContextBreakdown, string> = {
  system: "System prompt",
  catalogue: "Tool catalogue",
  tools: "Tool schemas",
  summary: "Compacted summary",
  history: "Earlier messages",
  historyTools: "Earlier tool traffic",
  input: "This turn",
  inputTools: "This turn's tools",
};

/** A missing part is nothing: turns measured before a part existed simply have no share of it. */
const partSize = (breakdown: ContextBreakdown, part: keyof ContextBreakdown) =>
  Math.max(0, breakdown[part] ?? 0);

/**
 * Just enough of a message to size it: what it is, and what part of it is tool traffic.
 * Structural rather than the API's own union, so the server can hand its outgoing messages
 * here and a test can hand it two object literals.
 */
export interface SizableMessage {
  role: string;
  tool_calls?: unknown;
}

const size = (value: unknown) => JSON.stringify(value)?.length ?? 0;

/**
 * How much of one message is tool traffic.
 *
 * A result is tool traffic entire — it is what a tool returned and nothing else. An assistant
 * message that asks for tools is not: it usually says something first, so only the calls it
 * made are counted here and the words it said stay with the conversation.
 */
const toolSize = (message: SizableMessage): number => {
  if (message.role === "tool") return size(message);
  const calls = message.tool_calls;
  return Array.isArray(calls) && calls.length ? size(calls) : 0;
};

/**
 * What a request was made of, in characters.
 *
 * Characters because nothing on the way back reports anything finer, and measured on the way
 * out because by the time a completion answers, the request is a single number. The parts are
 * cut the way the questions are asked: a system prompt that grew, a catalogue of tools nobody
 * calls, schemas for tools that are loaded, a summary standing in for the folded head of the
 * transcript, what has been said, and — usually the answer — what the tools handed back.
 *
 * `system` is what was actually sent and `systemPrompt` the configured part of it, so the
 * catalogue is the difference rather than a second thing to keep in step. `turnLength` is how
 * many of the trailing messages belong to this turn; `compacted` says whether the first is a
 * summary standing in for the messages it replaced.
 */
export function measureRequest(request: {
  system: string;
  systemPrompt: string;
  tools: unknown[];
  history: SizableMessage[];
  turnLength: number;
  compacted?: boolean;
}): ContextBreakdown {
  const { history, turnLength } = request;
  const cut = Math.max(0, history.length - Math.max(0, turnLength));
  const earlier = history.slice(request.compacted ? 1 : 0, cut);
  const mine = history.slice(cut);
  const sum = (messages: SizableMessage[], of: (message: SizableMessage) => number) =>
    messages.reduce((total, message) => total + of(message), 0);
  const said = (message: SizableMessage) => Math.max(0, size(message) - toolSize(message));

  return {
    system: request.systemPrompt.length,
    catalogue: Math.max(0, request.system.length - request.systemPrompt.length),
    tools: request.tools.length ? size(request.tools) : 0,
    summary: request.compacted && history.length ? size(history[0]) : 0,
    history: sum(earlier, said),
    historyTools: sum(earlier, toolSize),
    input: sum(mine, said),
    inputTools: sum(mine, toolSize),
  };
}

/**
 * Turns the measured size of each part of a request into token shares of `promptTokens`.
 *
 * The parts are counted in characters, because nothing in the round trip reports anything
 * finer: a completion says how many prompt tokens it read and not a word about where they
 * came from. So the proportions are an estimate and the total is not — the shares are scaled
 * to the number the server actually gave us, and the largest of them absorbs the rounding so
 * they add up to it exactly rather than to within a few tokens of it.
 *
 * Undefined when there is nothing to be a share of: no measured total, or no request.
 */
export function splitContext(
  chars: ContextBreakdown,
  promptTokens: number,
): ContextBreakdown | undefined {
  const size = (part: keyof ContextBreakdown) => partSize(chars, part);
  const total = PARTS.reduce((sum, part) => sum + size(part), 0);
  if (!total || promptTokens <= 0) return undefined;

  const absorber = PARTS.reduce((a, b) => (size(b) > size(a) ? b : a));
  // Only the four the type insists on are named here; the loop below writes every part,
  // the absorber included, so none is left as the zero this starts them at.
  const out: ContextBreakdown = { system: 0, tools: 0, history: 0, input: 0 };
  let assigned = 0;
  for (const part of PARTS) {
    if (part === absorber) continue;
    out[part] = Math.round((size(part) / total) * promptTokens);
    assigned += out[part];
  }
  out[absorber] = Math.max(0, promptTokens - assigned);
  return out;
}

export type BreakdownRow = {
  key: keyof ContextBreakdown;
  label: string;
  tokens: number;
  ratio: number;
};

/**
 * The split as rows to draw, in one order and with the empty ones left out — a session with
 * no tools wired up has nothing to say about tool schemas.
 */
export function breakdownRows(breakdown: ContextBreakdown): BreakdownRow[] {
  const total = PARTS.reduce((sum, part) => sum + partSize(breakdown, part), 0);
  if (!total) return [];
  return PARTS.filter((part) => partSize(breakdown, part) > 0).map((part) => ({
    key: part,
    label: BREAKDOWN_LABEL[part],
    tokens: partSize(breakdown, part),
    ratio: partSize(breakdown, part) / total,
  }));
}
