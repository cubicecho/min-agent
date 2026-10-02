import * as core from "@cubicecho/agent-core";
import type { HookContext, HookEvent, HookMessage } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import type { HookNote, Session, StoredMessage, StreamEvent } from "../shared/types.ts";
import * as mcp from "./mcp.ts";

/**
 * The MCP servers' hooks, fired at min-agent's points in a session.
 *
 * The pool runs them and never lets one fail a turn, and agent-core's hooks module decides what a
 * session looks like to them, where their context lands in a request, and what is said about each
 * one. This is the layer between the two that is min-agent's own: the pool as the runner, the
 * preface that names it, and a note as the chat's stream carries it. `agent.ts` calls it at each
 * point, and the sessions `onWrite` hook in `graphql/schema.ts` calls it for a delete.
 *
 * `sessionEnd` is never fired. A chat does not end, it is only left, and a hook bound to it
 * would wait for something that does not happen here.
 */

/** Every hook's `{{host}}`, so a server shared with kanban_server can tell the two apart. */
export const HOST = "min-agent";

/**
 * Where the pool's notices go. The pool prints nothing itself, as agent-core does not.
 *
 * @param message The pool's line about a hook that failed or was skipped.
 * @returns Nothing.
 */
const notice = (message: string) => console.warn(`[hooks] ${message}`);

/**
 * The pool, as the runner agent-core's hooks are handed.
 *
 * @param event Which of the servers' hooks to run.
 * @param context What they are told.
 * @param options `signal` ends them all.
 * @returns One outcome per hook. Never rejects, as the pool's `runHooks` does not.
 */
const run: core.HookRunner = (event, context, { signal }) =>
  mcp.runHooks(event, context, { signal, onNotice: notice });

/**
 * A note as the chat's stream carries it.
 *
 * @param emit Where the turn's events go, if anyone is listening.
 * @returns What agent-core calls with each note, or nothing when there is nobody to tell.
 */
const told = (emit?: (event: StreamEvent) => void) =>
  emit && ((hook: HookNote) => emit({ type: "hook", hook }));

/**
 * A stretch of the transcript as a memory server reads it: what the user and the assistant
 * said, and nothing else. Tool calls and their results are left out.
 *
 * The uuid is the chat's id, the message's index in the stored transcript and a digest of what
 * it says, so the same turn sent twice (afterTurn, then again when it is compacted) is one
 * memory, and an answer retried into the same position is another. The index is the stored
 * one because this reads `session.messages`, never a request a compaction has shortened.
 *
 * @param session The chat, with its whole transcript.
 * @param from The first index, inclusive.
 * @param to The end, exclusive. Defaults to the end of the transcript.
 * @returns The messages in that stretch that said something.
 */
export function turnMessages(session: Session, from: number, to?: number): HookMessage[] {
  return core.turnMessages(session.id, session.messages, from, to);
}

/**
 * Which turn of the session begins at `before`, from 0: the user messages ahead of it.
 *
 * @param messages The stored transcript.
 * @param before Where the turn begins. Defaults to the end of the transcript.
 * @returns The count.
 */
export const turnIndex = (messages: readonly StoredMessage[], before?: number) =>
  core.turnIndex(messages, before);

/**
 * Said once, above the blocks, so the model reads them as background and not as instructions.
 *
 * min-agent's own wording rather than agent-core's, and passed with each call rather than set
 * for the process: it is in every request that carries context, so a word changed here misses
 * the prompt cache for every chat already under way.
 */
const PREFACE =
  "The <context> blocks below were added by min-agent's MCP servers for this message. They " +
  "are background the user did not write and may not be relevant. The user's message follows them.";

/**
 * A question as the model is sent it: the hooks' context ahead of what the user typed.
 *
 * It goes on the question, not in the system prompt, because it is about the question. It also
 * keeps the system prompt fixed: a prompt that changed every turn would miss the prompt cache
 * every turn. The context is stored beside the question rather than in it (`hook_context`), so
 * it is never remembered as something the user said — and it is sent with that question on every
 * later request too, not only on its own turn. A past question that lost its context changed
 * the request from there on, and the answer after it and all its tool traffic were prefilled
 * again on every turn.
 *
 * @param message The question as the user typed it.
 * @param context The hooks' context. Empty returns `message` as it is.
 * @returns A new message. `message` is left as it was.
 */
export function withContext(
  message: OpenAI.ChatCompletionUserMessageParam,
  context: string | undefined,
): OpenAI.ChatCompletionUserMessageParam {
  // agent-core adds it to one message of a request. Here the request is the question alone, and
  // what comes back is still a user message, which the wider type it is returned as cannot say.
  const [sent] = core.withContext([message], 0, context ?? "", PREFACE);
  return sent as OpenAI.ChatCompletionUserMessageParam;
}

/** What `gather` found for a request. */
export interface Gathered {
  /** The `<context>` blocks, or empty when no hook added anything. */
  context: string;
  notes: HookNote[];
}

/**
 * Runs the injecting events' hooks ahead of a request and builds what they add to it.
 *
 * On the path of the first token, so the bounds matter:
 * - Each hook gets 3s unless its row says otherwise.
 * - `signal` ends all of them.
 * - A hook that fails costs the turn its context, never the turn.
 * - Blocks are capped per hook and 2000 tokens in total, so a generous server cannot crowd out
 *   the conversation it was meant to inform.
 *
 * @param events Which to run, in the order their context is assembled and the budget spent.
 * @param context What the hooks are told.
 * @param options `signal` is the turn's. `emit` hears each note as a `hook` event.
 * @returns The context to send with the question, and a note for each hook worth mentioning.
 */
export async function gather(
  events: readonly HookEvent[],
  context: HookContext,
  { signal, emit }: { signal?: AbortSignal; emit?: (event: StreamEvent) => void } = {},
): Promise<Gathered> {
  return core.gather(run, events, context, {
    signal,
    onNote: told(emit),
    maxTokens: core.HOOK_CONTEXT_TOKENS,
  });
}

/**
 * Runs the hooks for an event that reads what happened and adds nothing to a request.
 *
 * No signal: these run once the turn has been answered, and a reader who stops listening
 * at that point has not asked for the turn not to be remembered.
 *
 * @param event `afterTurn`, `beforeCompact` or `sessionDelete`.
 * @param context What the hooks are told.
 * @param emit Hears each note as a `hook` event.
 * @returns The notes, which with nothing injected are only ever failures.
 */
export async function notify(
  event: HookEvent,
  context: HookContext,
  emit?: (event: StreamEvent) => void,
): Promise<HookNote[]> {
  return core.notify(run, event, context, told(emit));
}

/**
 * A chat was deleted. Tells the servers that keep anything under its id. Never rejects, as
 * agent-core's `notify` does not, because this is called without being awaited.
 *
 * @param id The chat that went.
 * @returns The failures, for a caller that waits for them.
 */
export const sessionDeleted = (id: string) =>
  notify("sessionDelete", { session: { id }, host: HOST });
