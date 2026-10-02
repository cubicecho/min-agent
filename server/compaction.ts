import { type CompactionPlan, estimateTokens, planCompaction } from "@cubicecho/agent-core";
import type { Session, StoredMessage } from "../shared/types.ts";

/**
 * Context compaction, as far as it is min-agent's own.
 *
 * A long session eventually exceeds the model's context window and every further turn fails.
 * Rather than truncating — which drops what was decided early on, usually the part that
 * matters — the oldest stretch is replaced by a summary the model writes itself, and the recent
 * messages are kept verbatim.
 *
 * Where to cut, the summariser's instruction and the message the summary is sent as are
 * agent-core's (`planCompaction`, `runCompaction`, `applyCompaction`). What is left here is what
 * agent-core cannot know: that the fold is a record on the session beside an append-only
 * transcript, and how a stored message is weighed.
 *
 * The full transcript stays on disk untouched. Compaction only changes what is *sent*, so the
 * chat still displays every message and a later compaction can start from the summary before it.
 */

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

/**
 * What one stored message weighs against the kept tail: its text and its calls, and nothing else.
 *
 * Handed to `planCompaction` in place of its default, `messageTokens`, for two reasons. That one
 * reads a message as it will be sent, and these are stored ones: it would count
 * `reasoning_content`, which `forApi` strips and the model is never sent. And it adds each
 * message's envelope and call ids, which moves the cut later than this planner's predecessor put
 * it — on a transcript of short messages, by several exchanges.
 *
 * @param message One message of `session.messages`.
 * @returns Its estimated tokens.
 */
export const textTokens = (message: StoredMessage) => estimateTokens(messageText(message));

/**
 * Where to fold a session, or `undefined` when it should be left whole: the window is not three
 * quarters full, or the only legal cut takes too little to pay for the summary.
 *
 * agent-core's planner, told what min-agent keeps beside the transcript rather than in it. The
 * fold starts where the last one ended and continues its notes — both passed, because the scan
 * `planCompaction` falls back on looks for system messages at the head of the array, and the
 * system prompt and the summary are never stored there.
 *
 * @param session The chat, with its whole transcript and the fold in force, if any.
 * @param limit The model's window, in tokens. Zero never folds.
 * @param used What the last turn reported using. Zero, when nothing was reported, never folds:
 * it is passed as it is rather than left for the planner to estimate.
 * @returns The plan, whose `cut` is an index into `session.messages` and always a user message.
 */
export const planFold = (
  session: Pick<Session, "messages" | "compaction">,
  limit: number,
  used: number,
): CompactionPlan | undefined =>
  planCompaction(session.messages, {
    limit,
    used,
    estimate: textTokens,
    from: session.compaction?.through ?? 0,
    previous: session.compaction?.summary,
  });
