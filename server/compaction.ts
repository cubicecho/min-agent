import {
  type CompactionPlan,
  estimateFrom,
  estimateTokens,
  planCompaction,
  type TokenLedger,
} from "@cubicecho/agent-core";
import type OpenAI from "openai";
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

/** A message's content as one string, whichever of its shapes it was stored in. */
function bodyText(content: StoredMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content.map((part) => ("text" in part ? part.text : "")).join(" ");
  }
  return "";
}

export const messageText = (message: StoredMessage): string => {
  const body = bodyText(message.content);
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
 * What `costOf` falls back on for a message no reading covers, in place of agent-core's default,
 * `messageTokens`, for two reasons. That one
 * reads a message as it will be sent, and these are stored ones: it would count
 * `reasoning_content` whether or not `reasoningReplay` sends it. And it adds each message's
 * envelope and call ids, which moves the cut later than this planner's predecessor put it — on a
 * transcript of short messages, by several exchanges. Thinking that is sent back is still in what
 * the last turn reported using, which is what decides whether to fold at all; this only places
 * the cut.
 *
 * @param message One message of `session.messages`.
 * @returns Its estimated tokens.
 */
export const textTokens = (message: StoredMessage) => estimateTokens(messageText(message));

/**
 * What one stored message cost the window, measured where the session's ledger can say and
 * weighed by `textTokens` where it cannot: before the first reading, across the end of an epoch,
 * and for anything no request has carried yet.
 *
 * A measured cost is the server's own count — the template's tokens, the hooks' context on a
 * question and a tool result's real density in — and a reasoning that is not sent back is not in
 * it. The estimate is the planner's predecessor's, kept for what was never measured.
 *
 * @param session The chat, with its whole transcript and what its requests reported.
 * @returns A weight for `planCompaction`, which knows a message by identity: these messages.
 */
export const costOf = (session: Pick<Session, "messages" | "ledger">) =>
  estimateFrom(session.ledger ?? [], session.messages as OpenAI.ChatCompletionMessageParam[], {
    estimate: (message) => textTokens(message as StoredMessage),
  });

/**
 * A turn's ledger, re-indexed from the transcript the loop was handed into the stored one, and
 * laid after the session's own in epochs of its own.
 *
 * The loop's transcript is the stored one with its head replaced by a fold's summary, and an
 * empty system prompt ahead of it where there is no other, so the two line up at the tail: an
 * index there is the same distance from the end. A reading that lands ahead of what the fold left
 * was of the summary, and is dropped. A run never shares an epoch with the one before it, since
 * the loop cannot say the two requests began alike.
 *
 * @param session The chat, its stored transcript ending where the loop's does, and the fold in
 * force while the turn ran.
 * @param sent The loop's transcript as it ended (`result.messages`).
 * @param ledger The loop's readings, indexed into `sent`.
 * @returns The session's ledger with the turn's on the end, or the session's alone where the two
 * transcripts do not line up — a reply the loop split into one message per call, which is stored
 * whole.
 */
export function appendLedger(
  session: Pick<Session, "messages" | "ledger" | "compaction">,
  sent: readonly { role: string }[],
  ledger: TokenLedger,
): TokenLedger {
  const kept = session.ledger ?? [];
  const from = session.compaction?.through ?? 0;
  const shift = session.messages.length - sent.length;
  const linedUp = sent.every(
    (message, at) => at + shift < from || session.messages[at + shift]?.role === message.role,
  );
  if (!linedUp || ledger.length === 0) {
    return kept;
  }
  const epoch = kept.reduce((last, entry) => Math.max(last, entry.epoch), -1) + 1;
  const turn = ledger.flatMap((entry) =>
    entry.through + shift < from
      ? []
      : [{ ...entry, through: entry.through + shift, epoch: entry.epoch + epoch }],
  );
  return [...kept, ...turn];
}

/**
 * Where to fold a session, or `undefined` when it should be left whole: the window is not three
 * quarters full, or the only legal cut takes too little to pay for the summary.
 *
 * agent-core's planner, told what min-agent keeps beside the transcript rather than in it. The
 * fold starts where the last one ended and continues its notes — both passed, because the scan
 * `planCompaction` falls back on looks for system messages at the head of the array, and the
 * system prompt and the summary are never stored there. Each message is weighed by `costOf`.
 *
 * @param session The chat, with its whole transcript, the fold in force and its ledger.
 * @param limit The model's window, in tokens. Zero never folds.
 * @param used What the last turn reported using. Zero, when nothing was reported, never folds:
 * it is passed as it is rather than left for the planner to estimate.
 * @returns The plan, whose `cut` is an index into `session.messages`: a user message, or — where
 * no user message leaves enough folded — a reply inside the last question's tool loop, with that
 * question kept whole as the plan's `question`.
 */
export const planFold = (
  session: Pick<Session, "messages" | "compaction" | "ledger">,
  limit: number,
  used: number,
): CompactionPlan | undefined =>
  planCompaction(session.messages, {
    limit,
    used,
    estimate: costOf(session),
    from: session.compaction?.through ?? 0,
    previous: session.compaction?.summary,
  });
