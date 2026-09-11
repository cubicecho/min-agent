import { createHash } from "node:crypto";
import {
  contextBlocks,
  type HookContext,
  type HookEvent,
  type HookMessage,
  type HookOutcome,
} from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import { messageText } from "../shared/client/transcript.ts";
import type { Compaction, HookNote, Session, StoredMessage, StreamEvent } from "../shared/types.ts";
import * as mcp from "./mcp.ts";

/**
 * The MCP servers' hooks, fired at min-agent's points in a session.
 *
 * The pool runs them and never lets one fail a turn. This is the half that knows what a
 * min-agent session looks like: which messages make up a turn, where the context goes in the
 * request, and what the chat says about it. `agent.ts` calls it at each point, and the sessions
 * `onWrite` hook in `graphql/schema.ts` calls it for a delete.
 *
 * `sessionEnd` is never fired. A chat does not end, it is only left, and a hook bound to it
 * would wait for something that does not happen here.
 */

/** Every hook's `{{host}}`, so a server shared with kanban_server can tell the two apart. */
export const HOST = "min-agent";

/** Where the pool's notices go. The pool prints nothing itself, as agent-core does not. */
const notice = (message: string) => console.warn(`[hooks] ${message}`);

/**
 * A stretch of the transcript as a memory server reads it: what the user and the assistant
 * said, and nothing else.
 *
 * Tool calls and their results are left out. They are the model's working rather than the
 * conversation, and they are most of a transcript's characters. A server that filed them would
 * recall a directory listing ahead of the decision it led to.
 *
 * The uuid is stable for as long as the message is. The same turn sent twice (afterTurn, then
 * again when it is compacted) is one memory, not two. The text is part of it because an index
 * alone is not stable: a retry cuts the transcript back and writes a new message at the same
 * position, and a server that dedupes on uuid would keep the answer that was thrown away.
 *
 * @param from The first index, inclusive.
 * @param to The end, exclusive. Defaults to the end of the transcript.
 */
export function turnMessages(session: Session, from: number, to?: number): HookMessage[] {
  const end = Math.min(to ?? session.messages.length, session.messages.length);
  const out: HookMessage[] = [];
  for (let idx = Math.max(0, from); idx < end; idx++) {
    const message = session.messages[idx];
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = messageText(message).trim();
    if (!text) continue;
    const digest = createHash("sha256").update(`${message.role}\0${text}`).digest("hex");
    out.push({ speaker: message.role, text, uuid: `${session.id}:${idx}:${digest.slice(0, 12)}` });
  }
  return out;
}

/** Which turn of the session begins at `before`, from 0: the user messages ahead of it. */
export const turnIndex = (messages: readonly StoredMessage[], before = messages.length) =>
  messages.slice(0, before).filter((message) => message.role === "user").length;

/**
 * Where a turn's question sits in the request `forApi` builds. Once a compaction has folded the
 * head into one summary message, that is no longer where it sits in the session.
 */
export const requestIndex = (turnStart: number, compaction?: Compaction) =>
  compaction ? turnStart - compaction.through + 1 : turnStart;

/** Said once, above the blocks, so the model reads them as background and not as instructions. */
const PREFACE =
  "The <context> blocks below were added by min-agent's MCP servers for this message. They " +
  "are background the user did not write and may not be relevant. The user's message follows them.";

/**
 * The request, with the hooks' context added to this turn's question.
 *
 * It goes on the question, not in the system prompt, because it is about the question. It also
 * keeps the system prompt fixed: a prompt that changed every turn would miss the prompt cache
 * every turn. Nothing here is written back to the session. What is stored is what the user
 * typed, so the context is never remembered as something they said.
 *
 * @param index Where the question is in `history`. See `requestIndex`.
 * @returns A new array. `history` and its messages are left as they were.
 */
export function withContext(
  history: OpenAI.ChatCompletionMessageParam[],
  index: number,
  context: string,
): OpenAI.ChatCompletionMessageParam[] {
  const message = history[index];
  if (!context || message?.role !== "user") return history;
  const preface = `${PREFACE}\n\n${context}\n\n`;
  const content: OpenAI.ChatCompletionUserMessageParam["content"] =
    typeof message.content === "string"
      ? `${preface}${message.content}`
      : [{ type: "text", text: preface }, ...message.content];
  return history.map((item, at) => (at === index ? { ...message, content } : item));
}

/** The most context all of a request's hooks can add between them. */
const CONTEXT_TOKENS = 2000;

/**
 * The context a set of outcomes adds, and what the chat says about each: the context it added,
 * or why it added none. A hook that worked and added nothing says nothing. A remember that
 * succeeded is not news.
 *
 * The note keeps the text each hook added, as the pool cut it, so the chat can show exactly what
 * the model was given.
 */
function assemble(outcomes: readonly HookOutcome[]): Gathered {
  const blocks = contextBlocks(outcomes, { maxTokens: CONTEXT_TOKENS });
  const notes: HookNote[] = [];
  for (const outcome of outcomes) {
    const base = { event: outcome.event, source: outcome.label, hookId: outcome.hookId };
    if (!outcome.ok) {
      notes.push({ ...base, error: outcome.error ?? "failed" });
      continue;
    }
    const added = blocks.injected.find(
      (item) => item.serverId === outcome.serverId && item.hookId === outcome.hookId,
    );
    if (added) notes.push({ ...base, tokens: added.tokens, text: added.text });
  }
  return { context: blocks.text, notes };
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
 */
export async function gather(
  events: readonly HookEvent[],
  context: HookContext,
  { signal, emit }: { signal?: AbortSignal; emit?: (event: StreamEvent) => void } = {},
): Promise<Gathered> {
  const outcomes = (
    await Promise.all(
      events.map((event) => mcp.runHooks(event, context, { signal, onNotice: notice })),
    )
  ).flat();
  const gathered = assemble(outcomes);
  for (const hook of gathered.notes) emit?.({ type: "hook", hook });
  return gathered;
}

/**
 * Runs the hooks for an event that reads what happened and adds nothing to a request.
 *
 * No signal: these run once the turn has been answered, and a reader who stops listening
 * at that point has not asked for the turn not to be remembered.
 */
export async function notify(
  event: HookEvent,
  context: HookContext,
  emit?: (event: StreamEvent) => void,
): Promise<HookNote[]> {
  // Nothing on these events injects, so the notes are only ever failures.
  const { notes } = assemble(await mcp.runHooks(event, context, { onNotice: notice }));
  for (const hook of notes) emit?.({ type: "hook", hook });
  return notes;
}

/**
 * A chat was deleted. Tells the servers that keep anything under its id. Never rejects: the
 * pool's `runHooks` already does not, and this is called without being awaited.
 */
export const sessionDeleted = (id: string) =>
  notify("sessionDelete", { session: { id }, host: HOST }).catch(() => []);
