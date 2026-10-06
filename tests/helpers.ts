import type { Session, TurnStats } from "../shared/types.ts";

/**
 * What every folder of tests builds the same way: a session, a turn's stats, and the reading of
 * a body that went over the wire. Each is here once so a field added to a type is filled in
 * one place, and so a test names its fixture as what it is without asserting it.
 */

const CREATED = "2026-01-01T00:00:00.000Z";

/**
 * @param patch What differs from an empty, already-titled chat.
 * @returns A session with every required field filled.
 */
export const sessionOf = (patch: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "A chat",
  createdAt: CREATED,
  updatedAt: CREATED,
  messages: [],
  ...patch,
});

/**
 * @param patch The fields a test is about.
 * @returns A turn's stats with the rest at nothing: one step, no tools, no tokens.
 */
export const turnStats = (patch: Partial<TurnStats> = {}): TurnStats => ({
  model: "m",
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
  totalMs: 0,
  iterations: 1,
  toolCalls: 0,
  ...patch,
});

/**
 * @param value Anything.
 * @returns Whether it is an object with keys to read, and not a list.
 */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && Array.isArray(value) === false;

/**
 * Reads a posted body. Key order survives the parse, so `Object.keys` reads it back.
 * @param raw The JSON exactly as it went out.
 * @returns The object it holds.
 */
export function jsonBody(raw: string): Record<string, unknown> {
  const body: unknown = JSON.parse(raw);
  if (isRecord(body)) {
    return body;
  }
  throw new Error(`not a JSON object: ${raw}`);
}

/**
 * @param body A chat request, parsed.
 * @returns Its messages, each as the object it was sent as.
 */
export function messagesOf(body: Record<string, unknown>): Record<string, unknown>[] {
  const { messages } = body;
  if (Array.isArray(messages) && messages.every(isRecord)) {
    return messages;
  }
  throw new Error("the body carries no list of messages");
}

/**
 * @param body A chat request, parsed.
 * @returns The names of the tools it declared, in the order it declared them.
 */
export function declaredTools(body: Record<string, unknown>): string[] {
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools.map((tool: unknown) => {
    const declared = isRecord(tool) && isRecord(tool.function) ? tool.function.name : undefined;
    if (typeof declared === "string") {
      return declared;
    }
    throw new Error("a declared tool has no name");
  });
}

/**
 * @param message A message, stored or sent.
 * @returns Its content, which the test expects to be plain text.
 */
export function textOf(message: { content?: unknown }): string {
  if (typeof message.content === "string") {
    return message.content;
  }
  throw new Error("the message's content is not a string");
}

/**
 * @param thrown What a `catch` was handed.
 * @returns It, where it is an `Error`; anything else fails the test.
 */
export function errorOf(thrown: unknown): Error {
  if (thrown instanceof Error) {
    return thrown;
  }
  throw new Error(`threw something that is not an Error: ${String(thrown)}`);
}
