import type { LlmConfig, StoredMessage, TokenUsage, TurnStats } from "../types.ts";

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
