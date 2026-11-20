import * as core from "@cubicecho/agent-core";
import type { HookContext, HookEvent } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import type { HookNote, StoredMessage, StreamEvent } from "../shared/types.ts";
import type { Mcp } from "./mcp.ts";

/**
 * The MCP servers' hooks, fired at min-agent's points in a session.
 *
 * The pool runs them and never lets one fail a turn, and agent-core's loop fires them around each
 * question: `sessionStart` and `beforeExchange` before its first request, `beforeCompact` ahead of
 * a compaction, `afterExchange` once there is an answer. This is the layer between the two that is
 * min-agent's own: the pool as the runner, and a note as the chat's stream carries it. The preface
 * above the context is agent-core's (`HOOK_DEFAULTS.preface`), so it names the `<hook_context>`
 * blocks the loop writes. The sessions `onWrite` hook in `graphql/schema.ts` fires `sessionDelete`.
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

/** What the hooks run on: the app's MCP servers, or a test's stand-in for them. */
export type HookPool = Pick<Mcp, "hookRunner">;

/**
 * The pool, as the runner agent-core's hooks are handed: the pool's own `hookRunner`, with the
 * notices bound to this module's log line. It never rejects, as the pool's `runHooks` does not.
 *
 * @param mcp The servers whose hooks run.
 * @returns What runs one event's hooks, `signal` ending them all.
 */
const runnerOf = (mcp: HookPool): core.HookRunner => mcp.hookRunner({ onNotice: notice });

/**
 * A note as the chat's stream carries it.
 *
 * @param emit Where the turn's events go, if anyone is listening.
 * @returns What agent-core calls with each note, or nothing when there is nobody to tell.
 */
const told = (emit?: (event: StreamEvent) => void) =>
  emit && ((hook: HookNote) => emit({ type: "hook", hook }));

/**
 * A question as the model is sent it: the hooks' context ahead of what the user typed.
 *
 * The context is stored beside the question rather than in it (`hook_context`), so it is never
 * shown as something the user said, and put back on it whenever the transcript is rebuilt from
 * the stored rows: a past question that lost its context changes the request from there on, and
 * the server's prefix cache with it.
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
  const [sent] = core.withContext([message], 0, context ?? "");
  return sent as OpenAI.ChatCompletionUserMessageParam;
}

/**
 * The hooks as the loop takes them, for one question.
 *
 * `turnBase` puts the question back in the chat's own numbering: the loop counts the questions of
 * the transcript it is handed, and a compacted one holds fewer than the chat has asked.
 *
 * @param mcp The servers whose hooks run.
 * @param context The chat, the question as typed and its place in the chat, counted from 0.
 * @param options `first` fires `sessionStart` too. `turnBase` is the questions the chat has asked
 * that the transcript no longer holds. `emit` hears each note as a `hook` event.
 * @returns What `runAgentLoop` takes as `hooks`.
 */
export function exchangeHooks(
  mcp: HookPool,
  { session, prompt, index }: { session: { id: string }; prompt: string; index: number },
  {
    first,
    turnBase,
    emit,
  }: { first: boolean; turnBase: number; emit?: (event: StreamEvent) => void },
): core.AgentLoopHooks {
  const { SessionStart, BeforeExchange, BeforeCompact, AfterExchange } = core.HookEvent;
  return {
    run: runnerOf(mcp),
    // The loop puts its own `turn` on what it tells `afterExchange`.
    context: { session, host: HOST, prompt, turn: { index } },
    fire: [...(first ? [SessionStart] : []), BeforeExchange, BeforeCompact, AfterExchange],
    question: prompt,
    turnBase,
    // `afterExchange`'s are said by the turn once they are stored with its stats, as before.
    onNote: emit && ((note) => note.event !== AfterExchange && emit({ type: "hook", hook: note })),
  };
}

/**
 * How many questions a transcript holds ahead of a point, as agent-core counts them for a hook's
 * `turn.index`.
 *
 * @param messages The stored rows, or the model's transcript.
 * @param before Where to stop counting. Defaults to the end.
 * @returns The count.
 */
export const turnIndex = (
  messages: readonly (StoredMessage | OpenAI.ChatCompletionMessageParam)[],
  before?: number,
) => core.turnIndex(messages as OpenAI.ChatCompletionMessageParam[], before);

/**
 * Runs the hooks for an event that reads what happened and adds nothing to a request.
 *
 * No signal: a reader who stops listening has not asked for the chat not to be remembered.
 *
 * @param mcp The servers whose hooks run.
 * @param event `sessionDelete`, or any other event whose hooks add nothing to a request.
 * @param context What the hooks are told.
 * @param emit Hears each note as a `hook` event.
 * @returns The notes, which with nothing injected are only ever failures.
 */
export async function notify(
  mcp: HookPool,
  event: HookEvent,
  context: HookContext,
  emit?: (event: StreamEvent) => void,
): Promise<HookNote[]> {
  return core.notify(runnerOf(mcp), event, context, told(emit));
}

/**
 * A chat was deleted. Tells the servers that keep anything under its id. Never rejects, as
 * agent-core's `notify` does not, because this is called without being awaited.
 *
 * @param mcp The servers whose hooks run.
 * @param id The chat that went.
 * @returns The failures, for a caller that waits for them.
 */
export const sessionDeleted = (mcp: HookPool, id: string) =>
  notify(mcp, "sessionDelete", { session: { id }, host: HOST });
