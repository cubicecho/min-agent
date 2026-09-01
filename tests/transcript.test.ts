import { describe, expect, it } from "vitest";
import { messageText, turnStart, usageOf } from "../shared/client/transcript.ts";
import type { StoredMessage, TurnStats } from "../shared/types.ts";

const stats = (total: number): TurnStats => ({
  model: "m",
  promptTokens: total / 2,
  completionTokens: total / 2,
  totalTokens: total,
  totalMs: 1,
  iterations: 1,
  toolCalls: 0,
});

/** user, assistant+tool call, tool result, assistant — two turns, the first with a tool in it. */
const transcript = [
  { role: "user", content: "first" },
  { role: "assistant", content: "", tool_calls: [] },
  { role: "tool", content: "result", tool_call_id: "1" },
  { role: "assistant", content: "answer", stats: stats(100) },
  { role: "user", content: "second" },
  { role: "assistant", content: "again", stats: stats(40) },
] as unknown as StoredMessage[];

describe("messageText", () => {
  it("reads a plain string", () => {
    expect(messageText({ content: "hello" })).toBe("hello");
  });

  it("joins the parts of a content array", () => {
    expect(
      messageText({
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ] as never,
      }),
    ).toBe("ab");
  });

  it("is empty for anything else", () => {
    expect(messageText({ content: null })).toBe("");
    expect(messageText(undefined)).toBe("");
  });
});

describe("turnStart", () => {
  it("finds the user message a reply belongs to", () => {
    expect(turnStart(transcript, 3)).toBe(0);
    expect(turnStart(transcript, 5)).toBe(4);
  });

  it("returns the message itself when it is the user one", () => {
    expect(turnStart(transcript, 4)).toBe(4);
  });

  it("clamps an index past the end", () => {
    expect(turnStart(transcript, 99)).toBe(4);
  });

  it("is -1 when nothing before it was a question", () => {
    expect(turnStart([{ role: "assistant" }], 0)).toBe(-1);
    expect(turnStart([], 0)).toBe(-1);
  });
});

describe("usageOf", () => {
  it("adds up what the turns left over reported", () => {
    expect(usageOf(transcript).totalTokens).toBe(140);
    // Cut back to the first question: nothing has been answered, so nothing has been spent.
    expect(usageOf(transcript.slice(0, 4))).toEqual({
      promptTokens: 50,
      completionTokens: 50,
      totalTokens: 100,
    });
    expect(usageOf(transcript.slice(0, 1))).toEqual({
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
    });
  });
});
