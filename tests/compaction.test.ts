import { describe, expect, it } from "vitest";
import {
  COMPACT_AT,
  compactionMessage,
  messageText,
  needsCompaction,
  planCompaction,
  tokensOf,
  transcriptFor,
} from "../server/compaction.ts";
import type { StoredMessage } from "../shared/types.ts";

const say = (role: StoredMessage["role"], text: string) =>
  ({ role, content: text }) as StoredMessage;

/** A transcript of `pairs` user/assistant exchanges, each roughly `chars` long. */
const conversation = (pairs: number, chars = 400): StoredMessage[] =>
  Array.from({ length: pairs }, (_, i) => [
    say("user", `q${i} ${"x".repeat(chars)}`),
    say("assistant", `a${i} ${"y".repeat(chars)}`),
  ]).flat();

describe("needsCompaction", () => {
  it("waits until the window is filling up", () => {
    expect(needsCompaction(1000, 10000)).toBe(false);
    expect(needsCompaction(10000 * COMPACT_AT, 10000)).toBe(true);
  });

  it("stays off when the window is unknown", () => {
    expect(needsCompaction(999999, 0)).toBe(false);
  });
});

describe("messageText", () => {
  it("reads plain content, parts, and tool calls", () => {
    expect(messageText(say("user", "hello"))).toBe("hello");
    expect(
      messageText({
        role: "user",
        content: [
          { type: "text", text: "a" },
          { type: "text", text: "b" },
        ],
      } as StoredMessage),
    ).toBe("a b");
    expect(
      messageText({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "ls", arguments: "{}" } }],
      } as StoredMessage),
    ).toContain("ls({})");
  });
});

describe("planCompaction", () => {
  it("cuts so the kept tail fits the budget", () => {
    const messages = conversation(20);
    const cut = planCompaction(messages, 0, tokensOf(messages));
    expect(cut).toBeDefined();
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(messages.length);
  });

  it("always cuts immediately before a user message", () => {
    const messages = conversation(20);
    for (const limit of [2000, 6000, 12000, 40000]) {
      const cut = planCompaction(messages, 0, limit);
      if (cut !== undefined) expect(messages[cut].role).toBe("user");
    }
  });

  it("never splits an assistant call from its tool results", () => {
    const messages: StoredMessage[] = [
      say("user", "q"),
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "ls", arguments: "{}" } }],
      } as StoredMessage,
      { role: "tool", tool_call_id: "1", content: "files" } as StoredMessage,
      say("assistant", "done"),
      say("user", "next"),
      say("assistant", "ok"),
    ];
    const cut = planCompaction(messages, 0, 40);
    if (cut !== undefined) expect(messages[cut].role).toBe("user");
  });

  it("declines when there is too little to be worth a round trip", () => {
    expect(planCompaction(conversation(1), 0, 1_000_000)).toBeUndefined();
    expect(planCompaction([], 0, 1000)).toBeUndefined();
  });

  it("picks up after a previous compaction rather than redoing it", () => {
    const messages = conversation(20);
    const first = planCompaction(messages, 0, 4000);
    expect(first).toBeDefined();
    const second = planCompaction(messages, first as number, 4000);
    if (second !== undefined) expect(second).toBeGreaterThan(first as number);
  });
});

describe("transcriptFor", () => {
  it("labels each message by role and skips empty ones", () => {
    const text = transcriptFor([say("user", "hi"), say("assistant", ""), say("user", "bye")], 0, 3);
    expect(text).toBe("user: hi\n\nuser: bye");
  });
});

describe("compactionMessage", () => {
  it("presents the summary as system context", () => {
    const message = compactionMessage({ summary: "we chose X", through: 4, at: "" });
    expect(message.role).toBe("system");
    expect(message.content).toContain("we chose X");
  });
});
