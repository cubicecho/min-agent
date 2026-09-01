import type { StoredMessage, ToolCall, TurnStats } from "./types.ts";

/**
 * A message as a row: one column per thing, rather than the chat-completions message shape.
 *
 * The two disagree on spelling — the API writes `tool_calls` and `tool_call_id`, a Drizzle
 * column is `toolCalls` and `toolCallId` — and on nullability, since a column that is not set
 * is `null` where an absent property is `undefined`. Both directions live here so the server
 * and the client translate the same way, and so the GraphQL document and the stored row stay
 * one shape rather than three.
 */
export interface MessageShape {
  role: string;
  content: unknown;
  reasoningContent?: string | null;
  toolCalls?: ToolCall[] | null;
  toolCallId?: string | null;
  stats?: TurnStats | null;
  followups?: string[] | null;
}

/** A row, as the model and the transcript view want it. */
export function toStored(row: MessageShape): StoredMessage {
  return {
    role: row.role,
    content: row.content ?? null,
    ...(row.toolCalls?.length ? { tool_calls: row.toolCalls } : {}),
    ...(row.toolCallId ? { tool_call_id: row.toolCallId } : {}),
    ...(row.reasoningContent ? { reasoning_content: row.reasoningContent } : {}),
    ...(row.stats ? { stats: row.stats } : {}),
    ...(row.followups?.length ? { followups: row.followups } : {}),
  } as StoredMessage;
}

/** A message, as columns. */
export function fromStored(message: StoredMessage): MessageShape {
  const record = message as StoredMessage & {
    content?: unknown;
    tool_calls?: ToolCall[];
    tool_call_id?: string;
  };
  return {
    role: message.role,
    content: record.content ?? null,
    reasoningContent: message.reasoning_content ?? null,
    toolCalls: record.tool_calls ?? null,
    toolCallId: record.tool_call_id ?? null,
    stats: message.stats ?? null,
    followups: message.followups ?? null,
  };
}
