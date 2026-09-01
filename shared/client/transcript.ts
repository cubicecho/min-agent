import type { StoredMessage, TokenUsage } from "../types.ts";
import { emptyUsage } from "../types.ts";

/**
 * Reading a stored transcript: the parts of it that are arithmetic rather than rendering.
 *
 * Retrying a reply and editing a question are the same move — forget the transcript from a
 * point and go again — and both need to know where a turn started and what was said at it.
 * That is index work over an array, so it lives here where the root test runner can reach it,
 * rather than inside a React Native component that it cannot load.
 */

/** The text of a message, whichever of the two shapes the content arrived in. */
export function messageText(message: Pick<StoredMessage, "content"> | undefined): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/**
 * Where the turn containing `index` began — the user message at or before it.
 *
 * A turn is one user message and everything the model wrote in answer to it: the reply, the
 * tool calls, the results. Retrying the reply means running that user message again, so this
 * is the index to cut back to. -1 when there is no user message at or before it, which is a
 * transcript nothing can be retried from.
 */
export function turnStart(messages: readonly { role: string }[], index: number): number {
  for (let at = Math.min(index, messages.length - 1); at >= 0; at -= 1) {
    if (messages[at].role === "user") return at;
  }
  return -1;
}

/**
 * What the session's running total should say once the transcript ends at `count` messages.
 *
 * The banked usage is the sum of what each turn reported, and a turn reports it on the last
 * assistant message it wrote — so dropping the tail of a transcript is dropping those rows,
 * and the total is whatever the ones left over still add up to.
 */
export function usageOf(messages: readonly StoredMessage[]): TokenUsage {
  return messages.reduce((total, message) => {
    const stats = message.stats;
    if (!stats) return total;
    return {
      promptTokens: total.promptTokens + stats.promptTokens,
      completionTokens: total.completionTokens + stats.completionTokens,
      totalTokens: total.totalTokens + stats.totalTokens,
    };
  }, emptyUsage());
}
