import { expandNames, loadResult } from "@cubicecho/agent-core";
import type OpenAI from "openai";
import { describe, expect, it } from "vitest";
import { forApi } from "../server/agent.ts";
import { textTokens } from "../server/compaction.ts";
import { clampPruning, clearedChars, planPrune, sentWithStubs } from "../server/pruning.ts";
import { proxyLoadResult } from "../server/tool-proxy.ts";
import { PRUNING_DEFAULTS } from "../shared/defaults.ts";
import type { Session, StoredMessage } from "../shared/types.ts";

/**
 * Pruning as far as it is pure: what a marker does to what is sent, when the rule moves it, and
 * the thing the marker exists for — that a request is the one before it with only its tail added
 * for as long as the marker stays where it is.
 */

const AT = "2026-01-01T00:00:00.000Z";

/** A result of exactly `chars` characters, recognisable by its tag. */
const result = (tag: string, chars = 2000) => `${tag} ${"x".repeat(chars - tag.length - 1)}`;

/** The stub agent-core leaves for a result that was `chars` long. */
const stub = (chars: number) => `[result cleared, ${chars.toLocaleString("en-US")} chars]`;

/** One tool step: the assistant's call and the result that answers it. */
const step = (id: string, content: string, name = "fs__read"): StoredMessage[] => [
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name, arguments: `{"path":"/${id}"}` } }],
  },
  { role: "tool", tool_call_id: id, content },
];

/** A question and `count` tool steps after it, each result `chars` long. */
const turn = (question: string, count: number, chars = 2000, from = 0): StoredMessage[] => [
  { role: "user", content: question },
  ...Array.from({ length: count }, (_, at) =>
    step(`call-${from + at}`, result(`r${from + at}`, chars)),
  ).flat(),
];

const session = (messages: StoredMessage[], patch: Partial<Session> = {}) =>
  ({ id: "s1", messages, ...patch }) as Session;

/** Where the tool results are, by index into the transcript. */
const results = (messages: StoredMessage[]) =>
  messages.flatMap((message, at) => (message.role === "tool" ? [at] : []));

/** What a move to `through` would clear from `[from, through)`, by the planner's count. */
const clearedTokens = (messages: StoredMessage[], from: number, through: number) => {
  const sent = sentWithStubs(messages, { through });
  let total = 0;
  for (let at = from; at < through; at++) {
    if (sent[at] !== messages[at]) {
      total += textTokens(messages[at]) - textTokens(sent[at]);
    }
  }
  return total;
};

describe("the constants", () => {
  it("are agent-core's defaults, and a quarter of the window", () => {
    expect([
      PRUNING_DEFAULTS.keepLast,
      PRUNING_DEFAULTS.maxChars,
      PRUNING_DEFAULTS.windowShare,
    ]).toEqual([5, 256, 0.25]);
  });
});

describe("sentWithStubs", () => {
  it("hands back the transcript itself when there is no marker", () => {
    const messages = turn("q", 30);
    expect(sentWithStubs(messages)).toBe(messages);
    expect(sentWithStubs(messages, undefined)).toBe(messages);
    expect(sentWithStubs(messages, { through: 0 })).toBe(messages);
  });

  it("sends results before the marker as stubs and the rest whole", () => {
    const messages = turn("q", 8);
    const [, , third] = results(messages);
    const before = structuredClone(messages);

    const sent = sentWithStubs(messages, { through: third });

    expect(sent).toHaveLength(messages.length);
    for (const at of results(messages)) {
      if (at < third) {
        expect(sent[at]).toEqual({ ...messages[at], content: stub(2000) });
      } else {
        // Whole, and the very same object: nothing after the marker is rebuilt.
        expect(sent[at]).toBe(messages[at]);
      }
    }
    // Nothing but a tool result is ever replaced.
    for (const [at, message] of messages.entries()) {
      if (message.role !== "tool") {
        expect(sent[at]).toBe(message);
      }
    }
    // And the stored transcript is not what was rewritten.
    expect(messages).toEqual(before);
  });

  it("leaves a short result whole wherever it is", () => {
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("a", result("edge", PRUNING_DEFAULTS.maxChars)),
      ...step("b", result("over", PRUNING_DEFAULTS.maxChars + 1)),
      ...step("c", "ok"),
    ];
    const sent = sentWithStubs(messages, { through: messages.length });
    expect(sent[2].content).toBe(result("edge", PRUNING_DEFAULTS.maxChars));
    expect(sent[4].content).toBe(stub(PRUNING_DEFAULTS.maxChars + 1));
    expect(sent[6].content).toBe("ok");
  });

  it("hands back the transcript itself when nothing behind the marker is long enough", () => {
    const messages = turn("q", 8, 100);
    expect(sentWithStubs(messages, { through: messages.length })).toBe(messages);
  });

  it("does not reach past the end of the transcript for a marker left beyond it", () => {
    const messages = turn("q", 2);
    const sent = sentWithStubs(messages, { through: 99 });
    expect(sent).toHaveLength(messages.length);
    expect(sent.map((message) => message.content)).toEqual([
      "q",
      null,
      stub(2000),
      null,
      stub(2000),
    ]);
  });
});

describe("what is exempt from stubbing", () => {
  const catalog = [
    {
      id: "fs",
      label: "Files",
      tools: [{ name: "fs__read", description: "Read a file. ".repeat(30) }],
    },
  ];
  const definition = {
    type: "function" as const,
    function: {
      name: "fs__read",
      description: "Read a file. ".repeat(30),
      parameters: { type: "object", properties: { path: { type: "string" } } },
    },
  };
  const resolved = expandNames(["fs__read"], catalog);

  it("keeps a proxied load's definitions whole behind the marker", () => {
    const definitions = proxyLoadResult(resolved, catalog, [definition], new Set());
    expect(definitions.length).toBeGreaterThan(PRUNING_DEFAULTS.maxChars);
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("load", definitions, "load_tools"),
      ...step("read", result("file"), "call_tool"),
    ];

    const sent = sentWithStubs(messages, { through: messages.length });

    expect(sent[2]).toBe(messages[2]);
    expect(sent[4].content).toBe(stub(2000));
    // The schema is still there to be called from.
    expect(sent[2].content).toContain('"parameters":{"type":"object"');
  });

  it("hands back the transcript itself when definitions are all there is to clear", () => {
    const definitions = proxyLoadResult(resolved, catalog, [definition], new Set());
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("load", definitions, "load_tools"),
    ];
    expect(sentWithStubs(messages, { through: messages.length })).toBe(messages);
  });

  it("stubs an on-demand load's result, which only repeats what the tool array declares", () => {
    const loaded = loadResult(resolved, catalog, new Set());
    expect(loaded.length).toBeGreaterThan(PRUNING_DEFAULTS.maxChars);
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("load", loaded, "load_tools"),
    ];
    const sent = sentWithStubs(messages, { through: messages.length });
    expect(sent[2].content).toBe(stub(loaded.length));
  });

  it("stubs a proxied load that held no definitions: a pointer back, or a refusal", () => {
    const again = proxyLoadResult(resolved, catalog, [definition], new Set(["fs__read"]));
    const pointer = `${again}\n${"-".repeat(PRUNING_DEFAULTS.maxChars)}`;
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("load", pointer, "load_tools"),
    ];
    const sent = sentWithStubs(messages, { through: messages.length });
    expect(again.startsWith("Already loaded")).toBe(true);
    expect(sent[2].content).toBe(stub(pointer.length));
  });

  it("stubs the resource tools' results like any other", () => {
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("list", result("uris"), "list_resources"),
      ...step("read", result("resource"), "read_resource"),
    ];
    const sent = sentWithStubs(messages, { through: messages.length });
    expect([sent[2].content, sent[4].content]).toEqual([stub(2000), stub(2000)]);
  });
});

describe("planPrune", () => {
  /** A window in which clearing `tokens` is exactly the share that moves the marker. */
  const windowFor = (tokens: number) => tokens / PRUNING_DEFAULTS.windowShare;

  it("puts the marker on the earliest of the latest five results", () => {
    const messages = turn("q", 12);
    const at = results(messages);
    expect(planPrune(session(messages), 1000)).toBe(at[at.length - PRUNING_DEFAULTS.keepLast]);
    // So the five from there on are sent whole and the seven before are not.
    const sent = sentWithStubs(messages, { through: at[7] });
    expect(at.map((index) => sent[index].content === messages[index].content)).toEqual([
      ...Array(7).fill(false),
      ...Array(5).fill(true),
    ]);
  });

  it("does not move with five results or fewer, whatever they weigh", () => {
    for (const count of [0, 1, 5]) {
      const messages = turn("q", count, 40_000);
      expect(planPrune(session(messages), 1000)).toBeUndefined();
      expect(planPrune(session(messages), 1000, { compacted: true })).toBeUndefined();
    }
  });

  it("moves at the threshold and not a token below it", () => {
    const messages = turn("q", 8);
    const target = results(messages)[3];
    const cleared = clearedTokens(messages, 0, target);
    expect(cleared).toBeGreaterThan(0);

    expect(planPrune(session(messages), windowFor(cleared))).toBe(target);
    expect(planPrune(session(messages), windowFor(cleared + 1))).toBeUndefined();
    expect(planPrune(session(messages), 1_000_000)).toBeUndefined();
  });

  it("moves with a compaction however little that clears", () => {
    const messages = turn("q", 6);
    const target = results(messages)[1];
    expect(planPrune(session(messages), 1_000_000)).toBeUndefined();
    expect(planPrune(session(messages), 1_000_000, { compacted: true })).toBe(target);
  });

  it("does not move with a compaction when there is nothing to clear", () => {
    const messages = turn("q", 12, 100);
    expect(planPrune(session(messages), 1000, { compacted: true })).toBeUndefined();
  });

  it("does not move on its own when the window is unknown", () => {
    const messages = turn("q", 30, 40_000);
    expect(planPrune(session(messages), 0)).toBeUndefined();
    expect(planPrune(session(messages), Number.NaN)).toBeUndefined();
    expect(planPrune(session(messages), -1)).toBeUndefined();
  });

  it("never moves backwards, or to where it already is", () => {
    const messages = turn("q", 12);
    const target = results(messages)[7];
    for (const through of [target, target + 1, messages.length, messages.length + 50]) {
      const held = session(messages, { pruning: { through, at: AT } });
      expect(planPrune(held, 1000)).toBeUndefined();
      expect(planPrune(held, 1000, { compacted: true })).toBeUndefined();
    }
  });

  it("weighs only what lies between the marker and the target", () => {
    const messages = turn("q", 12);
    const at = results(messages);
    const target = at[7];
    // Three results already cleared: the next move is worth the four between, not all seven.
    const held = session(messages, { pruning: { through: at[3], at: AT } });
    const four = clearedTokens(messages, at[3], target);
    const seven = clearedTokens(messages, 0, target);
    expect(seven).toBeGreaterThan(four);

    expect(planPrune(held, windowFor(four))).toBe(target);
    expect(planPrune(held, windowFor(four + 1))).toBeUndefined();
    expect(planPrune(session(messages), windowFor(four + 1))).toBe(target);
  });

  it("does not count results a fold ahead of the marker has already taken out", () => {
    // Two turns; the fold ends where the second begins, well ahead of a marker that is not set.
    const first = turn("q0", 6);
    const messages = [...first, ...turn("q1", 8, 2000, 6)];
    const folded = { summary: "notes", through: first.length, at: AT };
    const at = results(messages);
    const target = at[at.length - PRUNING_DEFAULTS.keepLast];
    const sentOnly = clearedTokens(messages, first.length, target);
    const everything = clearedTokens(messages, 0, target);
    expect(everything).toBeGreaterThan(sentOnly);

    const held = session(messages, { compaction: folded });
    expect(planPrune(held, windowFor(sentOnly))).toBe(target);
    expect(planPrune(held, windowFor(sentOnly + 1))).toBeUndefined();
    // Without the fold the same window is passed easily.
    expect(planPrune(session(messages), windowFor(sentOnly + 1))).toBe(target);
  });

  it("does not move for a target the fold has already passed", () => {
    const messages = [...turn("q0", 12), { role: "user", content: "q1" } as StoredMessage];
    const folded = { summary: "notes", through: messages.length - 1, at: AT };
    const held = session(messages, { compaction: folded });
    expect(planPrune(held, 1000)).toBeUndefined();
    expect(planPrune(held, 1000, { compacted: true })).toBeUndefined();
  });

  it("counts from the marker when the fold is behind it", () => {
    const first = turn("q0", 2);
    const messages = [...first, ...turn("q1", 12, 2000, 2)];
    const at = results(messages);
    const marker = at[5];
    const target = at[at.length - PRUNING_DEFAULTS.keepLast];
    const held = session(messages, {
      compaction: { summary: "notes", through: first.length, at: AT },
      pruning: { through: marker, at: AT },
    });
    const between = clearedTokens(messages, marker, target);

    expect(planPrune(held, windowFor(between))).toBe(target);
    expect(planPrune(held, windowFor(between + 1))).toBeUndefined();
  });

  it("does not count what would be left whole: short results and a proxied load", () => {
    const definitions = `Loaded 1 tool(s). Run them with \`call_tool\`.\n\n${"d".repeat(4000)}`;
    const messages = [
      { role: "user", content: "q" } as StoredMessage,
      ...step("load", definitions, "load_tools"),
      ...step("short", "ok"),
      ...step("long", result("long")),
      ...turn("again", 5).slice(1),
    ];
    const target = results(messages)[3];
    const cleared = clearedTokens(messages, 0, target);
    // One result's worth, less its stub: neither the definitions nor the short one.
    expect(cleared).toBe(
      textTokens(messages[6]) - textTokens({ ...messages[6], content: stub(2000) }),
    );
    expect(planPrune(session(messages), windowFor(cleared))).toBe(target);
    expect(planPrune(session(messages), windowFor(cleared + 1))).toBeUndefined();
  });
});

describe("clampPruning", () => {
  const record = { through: 10, at: AT };

  it("pulls a marker past the cut back to it", () => {
    expect(clampPruning(record, 4)).toEqual({ through: 4, at: AT });
    expect(clampPruning(record, 0)).toEqual({ through: 0, at: AT });
  });

  it("leaves a marker at or behind the cut, and no marker, as they were", () => {
    expect(clampPruning(record, 10)).toBe(record);
    expect(clampPruning(record, 40)).toBe(record);
    expect(clampPruning(undefined, 4)).toBeUndefined();
  });
});

describe("clearedChars", () => {
  it("is nothing without a marker", () => {
    expect(clearedChars(session(turn("q", 12)))).toBe(0);
  });

  it("is what the stubs stand in for, as the request is measured", () => {
    const messages = turn("q", 12);
    const at = results(messages);
    const held = session(messages, { pruning: { through: at[7], at: AT } });
    const each = JSON.stringify(result("r0")).length - JSON.stringify(stub(2000)).length;
    expect(clearedChars(held)).toBe(7 * each);
  });

  it("leaves out what a fold took away, which was not going to be sent", () => {
    const messages = turn("q", 12);
    const at = results(messages);
    const held = session(messages, {
      pruning: { through: at[7], at: AT },
      compaction: { summary: "notes", through: at[4], at: AT },
    });
    const each = JSON.stringify(result("r0")).length - JSON.stringify(stub(2000)).length;
    expect(clearedChars(held)).toBe(3 * each);
  });
});

describe("forApi with a pruning marker", () => {
  type Sent = OpenAI.ChatCompletionMessageParam;

  /** Each message as it is serialised into a request body. */
  const wire = (chat: Session) => forApi(chat).map((message: Sent) => JSON.stringify(message));

  /** How many leading messages two requests share. */
  const shared = (a: string[], b: string[]) => {
    let at = 0;
    while (at < a.length && at < b.length && a[at] === b[at]) {
      at++;
    }
    return at;
  };

  it("sends a session that has no marker exactly as it is stored, however long", () => {
    const messages = [...turn("q0", 30, 8000), { role: "assistant", content: "Done." }];
    const sent = forApi(session(messages as StoredMessage[]));
    expect(sent).toEqual(messages);
  });

  it("stubs before the marker, strips min-agent's own fields, and leaves the session alone", () => {
    const messages: StoredMessage[] = [
      ...turn("q0", 8),
      { role: "assistant", content: "Done.", reasoning_content: "hm", followups: ["Why?"] },
    ];
    const at = results(messages);
    const chat = session(messages, { pruning: { through: at[3], at: AT } });
    const before = structuredClone(messages);

    const sent = forApi(chat);

    expect(at.map((index) => sent[index].content)).toEqual([
      stub(2000),
      stub(2000),
      stub(2000),
      ...at.slice(3).map((index) => messages[index].content),
    ]);
    expect(sent[sent.length - 1]).toEqual({ role: "assistant", content: "Done." });
    expect(chat.messages).toBe(messages);
    expect(messages).toEqual(before);
  });

  it("stubs behind a fold's summary too, by the stored index", () => {
    const first = turn("q0", 2);
    const messages = [...first, ...turn("q1", 8, 2000, 2)];
    const at = results(messages);
    const chat = session(messages, {
      compaction: { summary: "notes", through: first.length, at: AT },
      pruning: { through: at[5], at: AT },
    });

    const sent = forApi(chat);

    // The summary, then the second turn: its first three results cleared, its last five whole.
    expect(sent).toHaveLength(1 + messages.length - first.length);
    expect(sent[0].role).toBe("system");
    const tools = sent.filter((message) => message.role === "tool");
    expect(tools.map((message) => message.content)).toEqual([
      stub(2000),
      stub(2000),
      stub(2000),
      ...at.slice(5).map((index) => messages[index].content),
    ]);
  });

  /**
   * The point of the marker. A chat is grown one tool step at a time, across two turns, and each
   * request is compared with the one before it as it would be serialised.
   */
  it("extends the last request exactly while the marker stays put, and changes once when it moves", () => {
    const chat = session([{ role: "user", content: "q0" }]);
    // A window in which three cleared results are worth a move and two are not.
    const limit = Math.ceil(
      (2.5 * (textTokens({ role: "tool", tool_call_id: "x", content: result("r") }) - 8)) /
        PRUNING_DEFAULTS.windowShare,
    );

    let previous = wire(chat);
    /** Where each move left the marker, and where the request first differed from the last. */
    const moves: { from: number; through: number; differsAt: number }[] = [];

    const next = (messages: StoredMessage[]) => {
      chat.messages.push(...messages);
      // The rule, where a turn runs it: after a step's results are in.
      const through = planPrune(chat, limit);
      const from = chat.pruning?.through ?? 0;
      if (through !== undefined) {
        chat.pruning = { through, at: AT };
      }

      const now = wire(chat);
      const kept = shared(previous, now);
      if (through === undefined) {
        // An exact extension: every message sent before is sent again, byte for byte.
        expect(kept).toBe(previous.length);
        expect(now.length).toBeGreaterThan(previous.length);
      } else {
        moves.push({ from, through, differsAt: kept });
      }
      previous = now;
    };

    for (let at = 0; at < 14; at++) {
      next(step(`a${at}`, result(`a${at}`)));
    }
    next([{ role: "assistant", content: "Done." }]);
    // A second turn finds the first one's last request as its prefix, marker and all.
    next([{ role: "user", content: "q1" }]);
    for (let at = 0; at < 6; at++) {
      next(step(`b${at}`, result(`b${at}`)));
    }

    const at = results(chat.messages);
    // Three results accrue behind the latest five, then the marker steps over them.
    expect(moves.map((move) => move.through)).toEqual([at[3], at[6], at[9], at[12], at[15]]);
    for (const move of moves) {
      // Never backwards, and the request is untouched up to the old marker: what changes is the
      // first result behind the new one, which is the old marker itself once there is one.
      expect(move.through).toBeGreaterThan(move.from);
      expect(move.differsAt).toBe(move.from === 0 ? at[0] : move.from);
    }
    // Twenty-two requests, five of which missed: not one per tool step.
    expect(moves).toHaveLength(5);
    // And through all of it the transcript kept every result whole.
    expect(at.every((index) => (chat.messages[index].content as string).length === 2000)).toBe(
      true,
    );
  });
});
