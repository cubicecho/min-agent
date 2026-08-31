import type { Compaction, StoredMessage } from "../shared/types.ts";
import { estimateTokens } from "./side-tasks.ts";

/**
 * Context compaction.
 *
 * A long session eventually exceeds the model's context window and every further turn fails.
 * Rather than truncating — which drops what was decided early on, usually the part that
 * matters — the oldest stretch is replaced by a summary the model writes itself, and the recent
 * messages are kept verbatim.
 *
 * The full transcript stays on disk untouched. Compaction only changes what is *sent*, so the
 * chat still displays every message and a later compaction can start from the summary before it.
 */

/** Fraction of the window that must be in use before a summary is worth its own round trip. */
export const COMPACT_AT = 0.75;

/** Fraction of the window the kept tail is allowed to fill, leaving room to grow again. */
const KEEP_RATIO = 0.35;

export const messageText = (message: StoredMessage): string => {
  const { content } = message;
  const body =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => ("text" in part ? part.text : "")).join(" ")
        : "";
  const calls =
    "tool_calls" in message && message.tool_calls
      ? message.tool_calls
          .map((call) =>
            "function" in call ? `${call.function.name}(${call.function.arguments})` : "",
          )
          .join(" ")
      : "";
  return `${body} ${calls}`.trim();
};

export const tokensOf = (messages: StoredMessage[]) =>
  messages.reduce((total, message) => total + estimateTokens(messageText(message)), 0);

/** Has this session grown far enough into its window to be worth compacting? */
export const needsCompaction = (contextTokens: number, contextLimit: number) =>
  contextLimit > 0 && contextTokens >= contextLimit * COMPACT_AT;

/**
 * Picks how much of the transcript to fold into the summary.
 *
 * The cut must land immediately before a user message: a transcript that opens mid-exchange —
 * tool results with no assistant call to answer, an assistant reply with no question — is
 * malformed, and servers reject it. Returns `undefined` when no legal cut frees enough to be
 * worth the round trip.
 */
export function planCompaction(
  messages: StoredMessage[],
  from: number,
  contextLimit: number,
): number | undefined {
  const budget = contextLimit * KEEP_RATIO;

  // Walk back from the end until the kept tail fills the budget, then snap to a user message.
  let kept = 0;
  let cut = messages.length;
  for (let i = messages.length - 1; i > from; i--) {
    kept += estimateTokens(messageText(messages[i]));
    if (kept > budget) break;
    cut = i;
  }
  while (cut < messages.length && messages[cut].role !== "user") cut++;

  // Nothing legal to fold, or so little that summarising costs more than it saves.
  if (cut >= messages.length || cut - from < 2) return undefined;
  return cut;
}

/** The transcript handed to the summariser. Roles and text only; schemas are not worth summarising. */
export function transcriptFor(messages: StoredMessage[], from: number, through: number): string {
  return messages
    .slice(from, through)
    .map((message) => {
      const text = messageText(message);
      return text ? `${message.role}: ${text.slice(0, 4000)}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

export const SUMMARY_PROMPT =
  "You maintain the running memory of a long conversation. Rewrite the exchange below as " +
  "notes the assistant can rely on after the original messages are gone. Keep decisions, " +
  "facts, file paths, names, numbers, and anything still unresolved. Drop pleasantries and " +
  "anything already superseded. Write compact prose or bullets — no preamble, no sign-off.";

/** The system message that stands in for everything folded away. */
export const compactionMessage = (compaction: Compaction): StoredMessage => ({
  role: "system",
  content: `Summary of the earlier part of this conversation, which is no longer shown in full:\n\n${compaction.summary}`,
});
