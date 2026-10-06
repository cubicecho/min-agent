import { pruneToolResults } from "@cubicecho/agent-core";
import type OpenAI from "openai";
import { PRUNING_DEFAULTS } from "../shared/defaults.ts";
import type { PruningRecord, Session, StoredMessage } from "../shared/types.ts";
import { messageText, textTokens } from "./compaction.ts";
import { holdsDefinitions } from "./tool-proxy.ts";

/**
 * Old tool results cleared from what is replayed, without the prompt cache paying for it on
 * every step.
 *
 * A `read_file` of a 40k-character file is 10k tokens on every request after it, long after the
 * model has taken what it wanted. agent-core's `pruneToolResults` replaces all but the latest few
 * results with a one-line stub — but "the latest few" is a window that slides, and applied per
 * request each new result pushes an older one out, rewriting a message in the middle of the
 * history and losing the cache from there on, once per tool call.
 *
 * So the cut is stored. `session.pruning.through` is an index into the stored transcript: results
 * before it are sent as stubs, results at or after it whole, and nothing about a request depends
 * on how many results have arrived since. The marker is moved by `planPrune`, rarely — with a
 * compaction, which has rewritten the head of the request anyway, or when moving it clears enough
 * to be worth the one cache miss it costs. Between moves a request is the one before it with only
 * its tail added.
 *
 * As with compaction, only what is *sent* changes. The stored rows keep every result whole, and
 * the chat shows them as it always has.
 */

type Sent = OpenAI.ChatCompletionMessageParam;

/**
 * The stored transcript with the tool results behind the marker replaced by stubs.
 *
 * agent-core's `pruneToolResults` over the messages before the marker, keeping none: the stub is
 * `[result cleared, 12,345 chars]`, a result of `PRUNING_DEFAULTS.maxChars` or fewer is left as it is, and
 * so is anything that is not a tool result. One exemption is min-agent's own — a proxied
 * `load_tools` result that carries definitions (`holdsDefinitions`), which is the only copy of
 * them the model has; stubbed, the tool is one it can still name and no longer call correctly.
 *
 * A function of the transcript up to the marker and nothing else, which is the whole point: while
 * the marker stays put, what this returns for the messages behind it does not change, however
 * many are appended after it.
 *
 * @param messages The stored transcript. Not written to.
 * @param pruning The marker, or nothing for a session that has never been pruned.
 * @returns `messages` itself when nothing is cleared, so a session without a marker is sent
 * exactly as it was before there were markers. Otherwise a new array, the same length, sharing
 * every message it did not replace.
 */
export function sentWithStubs(
  messages: StoredMessage[],
  pruning?: Pick<PruningRecord, "through">,
): StoredMessage[] {
  // Clamped, so a marker left past the end of a transcript cannot reach messages not yet written.
  const through = Math.min(pruning?.through ?? 0, messages.length);
  if (through <= 0) {
    return messages;
  }

  const head = messages.slice(0, through);
  const stubbed = pruneToolResults(head as Sent[], {
    keepLast: 0,
    maxChars: PRUNING_DEFAULTS.maxChars,
  }) as StoredMessage[];
  if (stubbed === head) {
    return messages;
  }

  let cleared = false;
  const out = stubbed.map((message, at) => {
    if (message === head[at]) {
      return message;
    }
    if (holdsDefinitions(messageText(head[at]))) {
      return head[at];
    }
    cleared = true;
    return message;
  });
  return cleared ? [...out, ...messages.slice(through)] : messages;
}

/**
 * What a marker at `to` clears from the messages in `[from, to)`, by `weigh`.
 *
 * Asked of `sentWithStubs` rather than worked out beside it, so the rule that decides whether a
 * move is worth it and the readout that says what one saved cannot disagree with what is sent.
 */
function clearedBetween(
  messages: StoredMessage[],
  from: number,
  to: number,
  weigh: (message: StoredMessage) => number,
): number {
  const sent = sentWithStubs(messages, { through: to });
  if (sent === messages) {
    return 0;
  }
  let total = 0;
  for (let at = Math.max(0, from); at < Math.min(to, messages.length); at++) {
    if (sent[at] !== messages[at]) {
      total += weigh(messages[at]) - weigh(sent[at]);
    }
  }
  return total;
}

const size = (message: StoredMessage) => JSON.stringify(message.content)?.length ?? 0;

/**
 * How many characters the stubs in the next request stand in for, for the context readout.
 *
 * Only what would otherwise have been sent: a result a compaction folded into its summary was
 * not going to be replayed either way, so it is no saving of this. Measured the way
 * `measureRequest` sizes a message — as serialised JSON — so it sits on the same scale as the
 * parts it is shown beside.
 *
 * @param session The chat, with its whole transcript, its marker and its fold.
 */
export const clearedChars = (
  session: Pick<Session, "messages" | "compaction" | "pruning">,
): number =>
  clearedBetween(
    session.messages,
    session.compaction?.through ?? 0,
    session.pruning?.through ?? 0,
    size,
  );

/**
 * Where a move would put the marker: on the earliest of the latest `PRUNING_DEFAULTS.keepLast` tool
 * results, so those stay whole and everything behind them is cleared. Zero when there are not
 * that many results, which is nowhere.
 */
function keepBoundary(messages: StoredMessage[]): number {
  let kept = 0;
  for (let at = messages.length - 1; at >= 0; at--) {
    if (messages[at].role === "tool" && ++kept === PRUNING_DEFAULTS.keepLast) {
      return at;
    }
  }
  return 0;
}

/**
 * Where to move the marker to, or `undefined` when it should stay where it is.
 *
 * The rule, in the order it is checked:
 *
 * - **Never backwards, and never for nothing.** The target is the earliest of the latest five
 *   results. If that is not ahead of the marker, or moving there would clear nothing that is
 *   still being sent, the marker stays: a move that changes no request is a row written for
 *   nothing.
 * - **With a compaction.** A fold has just rewritten the head of the request, so the cache is
 *   lost from the first message whatever happens here, and anything a move clears is free.
 * - **On its own, past `PRUNING_DEFAULTS.windowShare`.** Otherwise the move has to pay for the miss it causes: what
 *   it would clear, by the planner's own count (`textTokens`), must be that share of the window.
 *   With no window known — a `limit` of zero — there is nothing to be a share of, and the marker
 *   does not move on its own, the same answer compaction gives to the same question.
 *
 * What is weighed is what a move would *clear*, not everything unpruned behind the target: a
 * short result and a proxied load's definitions stay whole wherever the marker is, and a result
 * already folded into a summary is not being sent. Counting those would move the marker for a
 * saving that is not there.
 *
 * @param session The chat: its whole transcript, the marker in force and the fold in force.
 * @param limit The model's window, in tokens. Zero when unknown.
 * @param options `compacted` when a fold was stored on this turn, ahead of this call.
 * @returns The new `through`, always greater than the one in force.
 */
export function planPrune(
  session: Pick<Session, "messages" | "compaction" | "pruning">,
  limit: number,
  { compacted = false }: { compacted?: boolean } = {},
): number | undefined {
  const current = session.pruning?.through ?? 0;
  const target = keepBoundary(session.messages);
  if (target <= current) {
    return undefined;
  }

  const from = Math.max(current, session.compaction?.through ?? 0);
  const cleared = clearedBetween(session.messages, from, target, textTokens);
  if (cleared <= 0) {
    return undefined;
  }
  if (compacted) {
    return target;
  }
  const hasNoWindow = Number.isNaN(limit) || limit <= 0;
  if (hasNoWindow) {
    return undefined;
  }
  return cleared >= limit * PRUNING_DEFAULTS.windowShare ? target : undefined;
}

/**
 * The marker after a transcript has been cut back to `length` messages.
 *
 * Pulled back to the cut when it was past it. The stubs behind the cut stay stubs, so a retry
 * finds the request's prefix where the last turn left it; what must not survive is a marker ahead
 * of the transcript, behind which the next results would arrive already cleared.
 *
 * @param pruning The marker in force, if any.
 * @param length Where the transcript now ends.
 */
export const clampPruning = (
  pruning: PruningRecord | undefined,
  length: number,
): PruningRecord | undefined =>
  pruning && pruning.through > length ? { ...pruning, through: length } : pruning;
