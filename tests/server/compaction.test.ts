import { describe, expect, it } from "vitest";
import { messageText, planFold, textTokens } from "../../server/compaction.ts";
import type { Session, StoredMessage } from "../../shared/types.ts";

const say = (role: "user" | "assistant", text: string): StoredMessage => ({ role, content: text });

/** A transcript of `pairs` user/assistant exchanges, each roughly `chars` long. */
const conversation = (pairs: number, chars = 400): StoredMessage[] =>
  Array.from({ length: pairs }, (_, i) => [
    say("user", `q${i} ${"x".repeat(chars)}`),
    say("assistant", `a${i} ${"y".repeat(chars)}`),
  ]).flat();

const call = (id: string, name: string, args: string) => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});

/**
 * A transcript of `turns` exchanges where every third is answered through two tool calls, with
 * the fields min-agent stores for itself on the messages that would carry them.
 */
/** One step of two tool calls and their results, as turn `i` stored it. */
const toolStep = (i: number): StoredMessage[] => [
  {
    role: "assistant",
    content: null,
    reasoning_content: "r".repeat(3000),
    tool_calls: [
      call(`c${i}a`, "fs__read", '{"path":"/a"}'),
      call(`c${i}b`, "fs__ls", '{"path":"/"}'),
    ],
  },
  { role: "tool", tool_call_id: `c${i}a`, content: "f".repeat(1200) },
  { role: "tool", tool_call_id: `c${i}b`, content: "d".repeat(300) },
];

const working = (turns: number): StoredMessage[] =>
  Array.from({ length: turns }, (_, i): StoredMessage[] => [
    say("user", `q${i} ${"x".repeat(200)}`),
    ...(i % 3 === 1 ? toolStep(i) : []),
    { ...say("assistant", `a${i} ${"y".repeat(200)}`), followups: ["Why?"] },
  ]).flat();

/** A fold that ended at `through`, for a session that has been compacted before. */
const folded = (through: number): Session["compaction"] =>
  through ? { summary: "earlier notes", through, at: "2026-01-01T00:00:00.000Z" } : undefined;

/**
 * Where a session is cut: the first message still sent whole.
 *
 * @param messages The stored transcript.
 * @param limit The window.
 * @param options `from` is where an earlier fold ended, and `used` what the last turn reported,
 * the whole window unless a test is about the threshold.
 */
const cutOf = (
  messages: StoredMessage[],
  limit: number,
  { from = 0, used = limit }: { from?: number; used?: number } = {},
) => planFold({ messages, compaction: folded(from) }, limit, used)?.cut;

describe("the threshold", () => {
  it("waits until the window is filling up", () => {
    const messages = conversation(20);
    expect(cutOf(messages, 10000, { used: 1000 })).toBeUndefined();
    expect(cutOf(messages, 10000, { used: 10000 * 0.75 - 1 })).toBeUndefined();
    expect(cutOf(messages, 10000, { used: 10000 * 0.75 })).toBeDefined();
  });

  it("stays off when the window is unknown", () => {
    expect(cutOf(conversation(20), 0, { used: 999999 })).toBeUndefined();
  });

  it("stays off when the last turn reported nothing, rather than estimating", () => {
    // 4040 tokens of transcript in a window of 1000: an estimate would fold it.
    expect(cutOf(conversation(20), 1000, { used: 0 })).toBeUndefined();
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
      }),
    ).toBe("a b");
    expect(
      messageText({
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "ls", arguments: "{}" } }],
      }),
    ).toContain("ls({})");
  });
});

describe("textTokens", () => {
  it("weighs what is said and called, and none of what min-agent stores for itself", () => {
    expect(textTokens(say("user", "x".repeat(400)))).toBe(100);
    expect(
      textTokens({
        role: "assistant",
        content: "x".repeat(400),
        reasoning_content: "r".repeat(4000),
        followups: ["Why?"],
      }),
    ).toBe(100);
    // `fs__ls({})`, ten characters, and not the call's id or its envelope.
    expect(
      textTokens({
        role: "assistant",
        content: null,
        tool_calls: [call("call-with-a-long-id", "fs__ls", "{}")],
      }),
    ).toBe(3);
  });
});

describe("planFold", () => {
  it("cuts so the kept tail fits the budget", () => {
    const messages = conversation(20);
    const cut = cutOf(
      messages,
      messages.reduce((total, message) => total + textTokens(message), 0),
    );
    expect(cut).toBeDefined();
    expect(cut).toBeGreaterThan(0);
    expect(cut).toBeLessThan(messages.length);
  });

  it("always cuts immediately before a user message", () => {
    const messages = conversation(20);
    for (const limit of [2000, 6000, 12000, 40000]) {
      const cut = cutOf(messages, limit);
      if (cut !== undefined) {
        expect(messages[cut].role).toBe("user");
      }
    }
  });

  it("never splits an assistant call from its tool results", () => {
    const messages: StoredMessage[] = [
      say("user", "q"),
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "1", type: "function", function: { name: "ls", arguments: "{}" } }],
      },
      { role: "tool", tool_call_id: "1", content: "files" },
      say("assistant", "done"),
      say("user", "next"),
      say("assistant", "ok"),
    ];
    const cut = cutOf(messages, 40);
    if (cut !== undefined) {
      expect(messages[cut].role).toBe("user");
    }
  });

  it("declines when there is too little to be worth a round trip", () => {
    expect(cutOf(conversation(1), 1_000_000)).toBeUndefined();
    expect(cutOf([], 1000)).toBeUndefined();
  });

  it("picks up after a previous compaction rather than redoing it", () => {
    const messages = conversation(20);
    const first = cutOf(messages, 4000);
    expect(first).toBeDefined();
    const second = cutOf(messages, 4000, { from: first as number });
    if (second !== undefined) {
      expect(second).toBeGreaterThan(first as number);
    }
  });

  it("hands the summariser the stretch from the last fold to the cut, and that fold's notes", () => {
    const messages = conversation(20);
    const plan = planFold({ messages, compaction: folded(10) }, 4000, 4000);
    expect(plan).toMatchObject({ from: 10, cut: 28, previous: "earlier notes" });
    expect(plan?.toSummarise).toEqual(messages.slice(10, 28));
    expect(planFold({ messages }, 4000, 4000)).not.toHaveProperty("previous");
  });
});

/**
 * The cut, for fixed inputs, as min-agent's own planner made it before agent-core's replaced it
 * (#50). Each expected value was read off that planner, so a row that changes is a long chat
 * compacting somewhere it did not use to.
 */
describe("where a long chat is cut", () => {
  const plain = conversation(20); // 40 messages of 101 tokens
  const tools = working(12); // 36 messages, a tool group in every third exchange

  it.each([
    // The window alone: a larger one keeps a longer tail.
    { limit: 1000, cut: 38 },
    { limit: 2000, cut: 34 },
    { limit: 4000, cut: 28 },
    { limit: 6000, cut: 20 },
    // The whole transcript fits the tail, and the first exchange is folded all the same.
    { limit: 12000, cut: 2 },
    { limit: 40000, cut: 2 },
    // After an earlier fold: the same cut until fewer than two messages are ahead of it.
    { limit: 1000, from: 10, cut: 38 },
    { limit: 1000, from: 24, cut: 38 },
    { limit: 1000, from: 36, cut: 38 },
    { limit: 1000, from: 38, cut: undefined },
    { limit: 1000, from: 40, cut: undefined },
    // What the last turn reported, either side of three quarters.
    { limit: 1000, used: 0, cut: undefined },
    { limit: 1000, used: 749, cut: undefined },
    { limit: 1000, used: 750, cut: 38 },
    { limit: 1000, used: 751, cut: 38 },
    { limit: 1000, used: 5000, cut: 38 },
    { limit: 0, used: 999999, cut: undefined },
  ])("plain exchanges: $limit window, from $from, used $used → $cut", ({ cut, limit, ...at }) => {
    expect(cutOf(plain, limit, at)).toBe(cut);
  });

  it.each([
    { limit: 300, cut: 34 },
    { limit: 600, cut: 34 },
    { limit: 1000, cut: 34 },
    { limit: 1500, cut: 34 },
    { limit: 2500, cut: 25 },
    { limit: 5000, cut: 16 },
    { limit: 2500, from: 5, cut: 25 },
    { limit: 2500, from: 20, cut: 25 },
    { limit: 2500, from: 23, cut: 25 },
    // One message ahead of the cut is not worth a summary.
    { limit: 2500, from: 24, cut: undefined },
    // The walk back stops short of `from`, so a later start is a later cut.
    { limit: 2500, from: 25, cut: 27 },
    { limit: 2500, from: 30, cut: 34 },
    { limit: 5000, from: 5, cut: 16 },
    { limit: 5000, from: 14, cut: 16 },
    { limit: 5000, from: 15, cut: undefined },
    { limit: 5000, from: 16, cut: 18 },
    { limit: 5000, from: 20, cut: 25 },
  ])("tool groups: $limit window, from $from → $cut", ({ cut, limit, ...at }) => {
    expect(cutOf(tools, limit, at)).toBe(cut);
    // Never inside a group: a result with no call ahead of it is a request servers refuse.
    if (cut !== undefined) {
      expect(tools[cut].role).toBe("user");
    }
  });
});
