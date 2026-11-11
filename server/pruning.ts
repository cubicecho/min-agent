import { type PrunePlan, planPrune as planBoundary, pruneThrough } from "@cubicecho/agent-core";
import type OpenAI from "openai";
import { PRUNING_DEFAULTS } from "../shared/defaults.ts";
import type { PruningRecord, Session, StoredMessage } from "../shared/types.ts";
import { textTokens } from "./compaction.ts";

/**
 * Old tool results cleared from what is replayed, without the prompt cache paying for it on
 * every step.
 *
 * A `read_file` of a 40k-character file is 10k tokens on every request after it, long after the
 * model has taken what it wanted. Stubbing all but the latest few results on every request would
 * be a window that slides — each new result pushes an older one out, rewriting a message in the
 * middle of the history and losing the cache from there on, once per tool call.
 *
 * So the cut is stored. `session.pruning.through` is an index into the stored transcript: results
 * before it are sent as stubs, results at or after it whole, and nothing about a request depends
 * on how many results have arrived since. The boundary and the rule that moves it are agent-core's
 * (`pruneThrough`, `planPrune`); what is min-agent's is that the boundary is a record on the
 * session, and the policy it is moved by — see `planPrune` below. Between moves a request is the
 * one before it with only its tail added.
 *
 * As with compaction, only what is *sent* changes. The stored rows keep every result whole, and
 * the chat shows them as it always has.
 */

type Sent = OpenAI.ChatCompletionMessageParam;

/**
 * The stored transcript with the tool results behind the marker replaced by stubs.
 *
 * agent-core's `pruneThrough`: the stub is `[result cleared, 12,345 chars]`, a result of
 * `PRUNING_DEFAULTS.maxChars` or fewer is left as it is, and so is anything that is not a tool
 * result — and a proxied `load_tools` result that carries definitions, which is the only copy of
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
export const sentWithStubs = (
  messages: StoredMessage[],
  pruning?: Pick<PruningRecord, "through">,
): StoredMessage[] =>
  pruneThrough(messages as Sent[], pruning?.through ?? 0, {
    maxChars: PRUNING_DEFAULTS.maxChars,
  }) as StoredMessage[];

const size = (message: StoredMessage) => JSON.stringify(message.content)?.length ?? 0;

/**
 * How many characters the stubs in the next request stand in for, for the context readout.
 *
 * Only what would otherwise have been sent: a result a compaction folded into its summary was
 * not going to be replayed either way, so it is no saving of this. Measured the way
 * `measureRequest` sizes a message — as serialised JSON — so it sits on the same scale as the
 * parts it is shown beside. Asked of `sentWithStubs` rather than worked out beside it, so the
 * readout cannot disagree with what is sent.
 *
 * @param session The chat, with its whole transcript, its marker and its fold.
 */
export function clearedChars(
  session: Pick<Session, "messages" | "compaction" | "pruning">,
): number {
  const { messages } = session;
  const sent = sentWithStubs(messages, session.pruning);
  if (sent === messages) {
    return 0;
  }
  const to = Math.min(session.pruning?.through ?? 0, messages.length);
  let total = 0;
  for (let at = Math.max(0, session.compaction?.through ?? 0); at < to; at++) {
    if (sent[at] !== messages[at]) {
      total += size(messages[at]) - size(sent[at]);
    }
  }
  return total;
}

/**
 * Where to move the marker to, or `undefined` when it should stay where it is.
 *
 * agent-core's `planPrune`, on min-agent's policy rather than its defaults:
 *
 * - **Never backwards, and never for nothing.** The target is the earliest of the latest five
 *   results. If that is not ahead of the marker, or moving there would clear nothing that is
 *   still being sent, the marker stays: a move that changes no request is a row written for
 *   nothing. A result before the fold is not being sent, so it is not counted.
 * - **With a compaction.** A fold has just rewritten the head of the request, so the cache is
 *   lost from the first message whatever happens here, and anything a move clears is free.
 * - **On its own, past `PRUNING_DEFAULTS.windowShare`.** Otherwise the move has to pay for the
 *   miss it causes: what it would clear, by the planner's own count (`textTokens`), must be that
 *   share of the window. With no window known — a `limit` of zero — the marker does not move on
 *   its own, the same answer compaction gives to the same question. There is no fill gate ahead
 *   of that (`at: 0`): the share alone is the hysteresis, and it is a high one.
 *
 * What is weighed is what a move would *clear*, not everything unpruned behind the target: a
 * short result and a proxied load's definitions stay whole wherever the marker is. Counting those
 * would move the marker for a saving that is not there.
 *
 * @param session The chat: its whole transcript, the marker in force and the fold in force.
 * @param limit The model's window, in tokens. Zero when unknown.
 * @param options `compacted` when a fold was stored on this turn, ahead of this call.
 * @returns The plan, whose `through` is always greater than the one in force.
 */
export const planPrune = (
  session: Pick<Session, "messages" | "compaction" | "pruning">,
  limit: number,
  { compacted = false }: { compacted?: boolean } = {},
): PrunePlan | undefined =>
  planBoundary(session.messages as Sent[], Number.isNaN(limit) ? 0 : limit, {
    through: session.pruning?.through ?? 0,
    at: 0,
    minShare: PRUNING_DEFAULTS.windowShare,
    from: session.compaction?.through ?? 0,
    compacted,
    keepLast: PRUNING_DEFAULTS.keepLast,
    maxChars: PRUNING_DEFAULTS.maxChars,
    estimate: (message) => textTokens(message as StoredMessage),
  });

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
