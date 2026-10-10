import { createHash } from "node:crypto";
import { contextBlocks, type HookOutcome } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import type { McpServerConfig, StoredMessage } from "../../shared/types.ts";
import { sessionOf, textOf } from "../helpers.ts";

const runHooks = vi.fn();

vi.mock("../../server/mcp.ts", () => ({ runHooks }));

const { gather, HOST, notify, sessionDeleted, turnIndex, turnMessages, withContext } = await import(
  "../../server/hooks.ts"
);
const { assertMcpServers } = await import("../../server/config.ts");

/**
 * The half of hooks that is min-agent's own: the pool runs them, and this decides what a
 * session looks like to them, where their context lands in a request, and what the chat is told.
 *
 * The pool is mocked out. Its running of hooks is tested where it lives.
 */

const session = (messages: StoredMessage[]) => sessionOf({ messages });

const transcript: StoredMessage[] = [
  { role: "user", content: "what is in /tmp?" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "c1", type: "function", function: { name: "fs__ls", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "c1", content: "a.txt\nb.txt" },
  { role: "assistant", content: "Two files." },
];

/**
 * Every shape a stored message's content comes in: padded text, an answer that is only tool
 * calls, text in parts, a part that is not text, a refusal, blank text, and the roles that are
 * not the conversation.
 */
const mixed: StoredMessage[] = [
  { role: "user", content: "  what is in /tmp?  " },
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "c1", type: "function", function: { name: "fs__ls", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "c1", content: "a.txt" },
  {
    role: "assistant",
    content: [
      { type: "text", text: "Two " },
      { type: "text", text: "files." },
    ],
  },
  { role: "system", content: "sys" },
  {
    role: "user",
    content: [
      { type: "text", text: "look" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ],
  },
  { role: "assistant", content: [{ type: "refusal", refusal: "no" }] },
  { role: "assistant", content: "   " },
  { role: "developer", content: "dev" },
  { role: "user", content: "last" },
];

const outcome = (patch: Partial<HookOutcome>): HookOutcome => ({
  serverId: "mem",
  label: "Memory",
  hookId: "recall",
  event: "beforeTurn",
  ok: true,
  ms: 1,
  inject: false,
  maxTokens: 1000,
  ...patch,
});

/** What min-agent says above the hooks' context. Its own wording, not agent-core's. */
const PREFACE =
  "The <context> blocks below were added by min-agent's MCP servers for this message. They " +
  "are background the user did not write and may not be relevant. The user's message follows them.";

// In a block, so the mock is not what the hook returns: Vitest calls a function a `beforeEach`
// returns as that test's cleanup, which would call the mock once more after every test.
beforeEach(() => {
  runHooks.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("turnMessages", () => {
  it("keeps what was said and leaves the tool traffic out", () => {
    const messages = turnMessages(session(transcript), 0);
    expect(messages.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
      { speaker: "user", text: "what is in /tmp?" },
      { speaker: "assistant", text: "Two files." },
    ]);
  });

  it("names each message by chat and position, and by what it says", () => {
    const [question, answer] = turnMessages(session(transcript), 0);
    expect(question.uuid).toMatch(/^s1:0:[0-9a-f]{12}$/);
    expect(answer.uuid).toMatch(/^s1:3:/);

    // The same message sent again is the same memory; an answer retried into its place is not.
    expect(turnMessages(session(transcript), 0)[1].uuid).toBe(answer.uuid);
    const retried: StoredMessage[] = [
      ...transcript.slice(0, 3),
      { role: "assistant", content: "Three." },
    ];
    expect(turnMessages(session(retried), 3)[0].uuid).not.toBe(answer.uuid);
  });

  it("reads only the stretch it is asked for", () => {
    expect(turnMessages(session(transcript), 1, 3)).toEqual([]);
    expect(turnMessages(session(transcript), 3).map((message) => message.text)).toEqual([
      "Two files.",
    ]);
  });

  // A memory server dedupes on the uuid, so it is pinned to the character: the chat's id, the
  // message's index in the stored transcript, and the first 12 hex digits of the sha256 of
  // `role\0text`, with the text trimmed.
  it("builds each uuid from the chat, the index and a digest of the trimmed text", () => {
    expect(turnMessages(session(mixed), 0)).toEqual([
      { speaker: "user", text: "what is in /tmp?", uuid: "s1:0:1c7646e9e5c5" },
      { speaker: "assistant", text: "Two files.", uuid: "s1:3:8e70f97a9ced" },
      { speaker: "user", text: "look", uuid: "s1:5:369c4fa58fb1" },
      { speaker: "user", text: "last", uuid: "s1:9:160099b623dc" },
    ]);
    const digest = createHash("sha256").update("assistant\0Two files.").digest("hex");
    expect(turnMessages(session(mixed), 3, 4)[0].uuid).toBe(`s1:3:${digest.slice(0, 12)}`);
  });

  it("clamps the stretch to the transcript, and reads nothing from one that is backwards", () => {
    const uuids = (from: number, to?: number) =>
      turnMessages(session(mixed), from, to).map((message) => message.uuid);
    expect(uuids(-5, 4)).toEqual(["s1:0:1c7646e9e5c5", "s1:3:8e70f97a9ced"]);
    expect(uuids(2, 99)).toEqual(["s1:3:8e70f97a9ced", "s1:5:369c4fa58fb1", "s1:9:160099b623dc"]);
    expect(uuids(9, 2)).toEqual([]);
    expect(uuids(0, 0)).toEqual([]);
    expect(uuids(10)).toEqual([]);
  });
});

describe("turnIndex", () => {
  it("counts the turns ahead of a point", () => {
    expect(turnIndex([])).toBe(0);
    expect(turnIndex(transcript)).toBe(1);
    expect(turnIndex(transcript, 0)).toBe(0);
  });

  it("counts only the questions, wherever the point falls", () => {
    expect(turnIndex(mixed)).toBe(3);
    expect(turnIndex(mixed, 3)).toBe(1);
    expect(turnIndex(mixed, 6)).toBe(2);
    expect(turnIndex(mixed, 99)).toBe(3);
    // A negative point counts back from the end, as `slice` does.
    expect(turnIndex(mixed, -1)).toBe(2);
  });
});

describe("withContext", () => {
  const question: OpenAI.ChatCompletionUserMessageParam = { role: "user", content: "now" };

  it("puts the context ahead of the question, and leaves the stored one alone", () => {
    const sent = withContext(question, '<context source="Memory">likes tea</context>');
    expect(sent.content).toContain('<context source="Memory">likes tea</context>');
    expect(textOf(sent).endsWith("now")).toBe(true);
    expect(question.content).toBe("now");
  });

  it("adds a part to a question that is already a list of parts", () => {
    const sent = withContext({ role: "user", content: [{ type: "text", text: "now" }] }, "ctx");
    expect(sent.content).toEqual([
      { type: "text", text: expect.stringContaining("ctx") },
      { type: "text", text: "now" },
    ]);
  });

  it("returns the question as it is when there is no context", () => {
    expect(withContext(question, "")).toBe(question);
    expect(withContext(question, undefined)).toBe(question);
  });

  // The preface is part of every request that carries context, so a word changed here changes
  // what the model reads and misses the prompt cache for every chat already under way.
  it("says min-agent's own preface above the context, to the character", () => {
    expect(withContext(question, "CTX")).toEqual({
      role: "user",
      content: `${PREFACE}\n\nCTX\n\nnow`,
    });
  });

  it("leads a list of parts with one text part, and keeps the rest of the message", () => {
    const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } } as const;
    const parts: OpenAI.ChatCompletionUserMessageParam = {
      role: "user",
      name: "bob",
      content: [{ type: "text", text: "now" }, image],
    };
    const before = structuredClone(parts);

    expect(withContext(parts, "CTX")).toEqual({
      role: "user",
      name: "bob",
      content: [
        { type: "text", text: `${PREFACE}\n\nCTX\n\n` },
        { type: "text", text: "now" },
        image,
      ],
    });
    expect(parts).toEqual(before);
  });
});

describe("gather", () => {
  it("builds context from the hooks that added some, and tells the chat", async () => {
    runHooks.mockImplementation(async (event: string) =>
      event === "beforeTurn"
        ? [outcome({ inject: true, text: "likes tea" })]
        : [outcome({ event: "sessionStart", hookId: "hello", ok: false, error: "timed out" })],
    );
    const emitted: unknown[] = [];

    const gathered = await gather(
      ["sessionStart", "beforeTurn"],
      { session: { id: "s1" } },
      { emit: (event) => emitted.push(event) },
    );

    expect(gathered.context).toContain("likes tea");
    expect(gathered.notes).toEqual([
      { event: "sessionStart", source: "Memory", hookId: "hello", error: "timed out" },
      {
        event: "beforeTurn",
        source: "Memory",
        hookId: "recall",
        tokens: expect.any(Number),
        text: "likes tea",
      },
    ]);
    expect(emitted).toEqual(gathered.notes.map((hook) => ({ type: "hook", hook })));
  });

  it("adds what the pool would, and keeps each hook's share of it as cut", async () => {
    const long = "x ".repeat(3000);
    const outcomes = [
      outcome({ hookId: "a", inject: true, text: long, maxTokens: 1200 }),
      outcome({ hookId: "b", inject: true, text: long, maxTokens: 1200 }),
      outcome({ hookId: "c", inject: true, text: "nothing left for this" }),
    ];
    runHooks.mockResolvedValue(outcomes);
    const pool = contextBlocks(outcomes);

    const gathered = await gather(["beforeTurn"], { session: { id: "s1" } });

    expect(gathered.context).toBe(pool.text);
    expect(gathered.notes.map((note) => note.tokens)).toEqual(
      pool.injected.map((item) => item.tokens),
    );
    for (const note of gathered.notes) {
      expect(note.text?.endsWith("…")).toBe(true);
      expect(gathered.context).toContain(`">\n${note.text}\n</context>`);
    }
  });

  it("says nothing about a hook that worked and added nothing", async () => {
    runHooks.mockResolvedValue([outcome({ inject: false, text: "stored" })]);
    expect(await gather(["beforeTurn"], { session: { id: "s1" } })).toEqual({
      context: "",
      notes: [],
    });
  });

  it("assembles in the order of the events, whichever answers first", async () => {
    runHooks.mockImplementation(async (event: string) => {
      if (event === "beforeTurn") {
        return [outcome({ inject: true, text: "likes tea" })];
      }
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [
        outcome({ event: "sessionStart", hookId: "hello", inject: true, text: "  met before  " }),
        outcome({ event: "sessionStart", hookId: "log", text: "stored" }),
        outcome({ event: "sessionStart", hookId: "audit", ok: false }),
      ];
    });
    const emit = vi.fn();

    const gathered = await gather(
      ["sessionStart", "beforeTurn"],
      { session: { id: "s1" } },
      { emit },
    );

    expect(gathered).toEqual({
      context:
        '<context source="Memory">\nmet before\n</context>\n\n' +
        '<context source="Memory">\nlikes tea\n</context>',
      notes: [
        { event: "sessionStart", source: "Memory", hookId: "hello", tokens: 3, text: "met before" },
        { event: "sessionStart", source: "Memory", hookId: "audit", error: "failed" },
        { event: "beforeTurn", source: "Memory", hookId: "recall", tokens: 3, text: "likes tea" },
      ],
    });
    // Once per note, in the notes' order, and with the note itself.
    expect(emit.mock.calls).toEqual(gathered.notes.map((hook) => [{ type: "hook", hook }]));
    expect(emit.mock.calls[0][0].hook).toBe(gathered.notes[0]);
  });

  it("runs each event once, with the context, the turn's signal and the notice", async () => {
    runHooks.mockResolvedValue([]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = { session: { id: "s1" }, host: HOST, prompt: "now" };
    const { signal } = new AbortController();

    await gather(["sessionStart", "beforeTurn"], context, { signal });

    expect(runHooks.mock.calls.map(([event]) => event)).toEqual(["sessionStart", "beforeTurn"]);
    for (const [, told, options] of runHooks.mock.calls) {
      expect(told).toBe(context);
      expect(options.signal).toBe(signal);
      options.onNotice('Memory: beforeTurn hook "recall" failed: boom');
    }
    expect(warn.mock.calls).toEqual([
      ['[hooks] Memory: beforeTurn hook "recall" failed: boom'],
      ['[hooks] Memory: beforeTurn hook "recall" failed: boom'],
    ]);
  });

  it("holds each hook to its own cap and all of them to 2000 tokens", async () => {
    const long = "x ".repeat(3000);
    runHooks.mockResolvedValue([
      outcome({ hookId: "a", inject: true, text: long, maxTokens: 1200 }),
      outcome({ hookId: "b", inject: true, text: long, maxTokens: 1200 }),
      outcome({ hookId: "c", inject: true, text: "nothing left for this" }),
      outcome({ hookId: "d", ok: false, error: "timed out" }),
    ]);
    const first = `${"x ".repeat(2399)}x…`;
    const second = `${"x ".repeat(1599)}x…`;

    expect(await gather(["beforeTurn"], { session: { id: "s1" } })).toEqual({
      context:
        `<context source="Memory">\n${first}\n</context>\n\n` +
        `<context source="Memory">\n${second}\n</context>`,
      notes: [
        { event: "beforeTurn", source: "Memory", hookId: "a", tokens: 1200, text: first },
        { event: "beforeTurn", source: "Memory", hookId: "b", tokens: 800, text: second },
        // Past the budget, a hook that failed is still said to have failed.
        { event: "beforeTurn", source: "Memory", hookId: "d", error: "timed out" },
      ],
    });
  });

  it("cuts one hook's text to its cap, and escapes the label it is filed under", async () => {
    runHooks.mockResolvedValue([
      outcome({ label: 'a"<b>&', inject: true, text: "abcdefghij", maxTokens: 2 }),
      outcome({ hookId: "blank", inject: true, text: "   " }),
      outcome({ hookId: "silent", inject: true }),
    ]);

    expect(await gather(["beforeTurn"], { session: { id: "s1" } })).toEqual({
      context: '<context source="a&quot;&lt;b>&amp;">\nabcdefg…\n</context>',
      notes: [
        { event: "beforeTurn", source: 'a"<b>&', hookId: "recall", tokens: 2, text: "abcdefg…" },
      ],
    });
  });
});

describe("notify", () => {
  it("notes only the failures, and passes no signal", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "afterTurn", hookId: "remember" }),
      outcome({ event: "afterTurn", hookId: "audit", ok: false, error: "boom" }),
    ]);

    const notes = await notify("afterTurn", { session: { id: "s1" } });

    expect(notes).toEqual([
      { event: "afterTurn", source: "Memory", hookId: "audit", error: "boom" },
    ]);
    expect(runHooks.mock.calls[0][2].signal).toBeUndefined();
  });

  it("runs the one event, tells the chat each failure once, and hands the notes back", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "afterTurn", hookId: "remember", text: "stored" }),
      outcome({ event: "afterTurn", hookId: "audit", ok: false, error: "boom" }),
      outcome({ event: "afterTurn", hookId: "index", label: "Search", ok: false }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = { session: { id: "s1" }, host: HOST, reply: "Two files." };
    const emit = vi.fn();

    const notes = await notify("afterTurn", context, emit);

    expect(notes).toEqual([
      { event: "afterTurn", source: "Memory", hookId: "audit", error: "boom" },
      { event: "afterTurn", source: "Search", hookId: "index", error: "failed" },
    ]);
    expect(emit.mock.calls).toEqual(notes.map((hook) => [{ type: "hook", hook }]));

    expect(runHooks).toHaveBeenCalledTimes(1);
    const [event, told, options] = runHooks.mock.calls[0];
    expect(event).toBe("afterTurn");
    expect(told).toBe(context);
    options.onNotice("Memory: boom");
    expect(warn).toHaveBeenCalledExactlyOnceWith("[hooks] Memory: boom");
  });

  it("has nothing to say when every hook worked", async () => {
    runHooks.mockResolvedValue([outcome({ event: "beforeCompact", text: "stored" })]);
    const emit = vi.fn();

    expect(await notify("beforeCompact", { session: { id: "s1" } }, emit)).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("sessionDeleted", () => {
  it("fires sessionDelete with the chat's id and min-agent's name", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "sessionDelete", hookId: "forget", ok: false, error: "boom" }),
    ]);

    expect(await sessionDeleted("s1")).toEqual([
      { event: "sessionDelete", source: "Memory", hookId: "forget", error: "boom" },
    ]);
    expect(HOST).toBe("min-agent");
    expect(runHooks).toHaveBeenCalledTimes(1);
    expect(runHooks.mock.calls[0].slice(0, 2)).toEqual([
      "sessionDelete",
      { session: { id: "s1" }, host: "min-agent" },
    ]);
  });

  // It is called without being awaited, so a rejection would be an unhandled one.
  it("never rejects, even when the pool does", async () => {
    runHooks.mockRejectedValue(new Error("pool exploded"));
    await expect(sessionDeleted("s1")).resolves.toBeDefined();
  });
});

describe("assertMcpServers", () => {
  const row = (patch: Partial<McpServerConfig>): McpServerConfig => ({
    id: "mem",
    label: "",
    enabled: true,
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    url: "",
    headers: {},
    hiddenTools: [],
    hooks: [],
    ...patch,
  });

  it("accepts hooks the pool can run", () => {
    expect(() =>
      assertMcpServers([
        row({
          hooks: [
            { id: "recall", on: "beforeTurn", tool: "recall", inject: true, args: "{{prompt}}" },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("refuses a hook that asks for what its event never has, naming the row", () => {
    expect(() =>
      assertMcpServers([
        row({ hooks: [{ id: "early", on: "beforeTurn", tool: "t", args: { a: "{{reply}}" } }] }),
      ]),
    ).toThrow(/^mem: .*reply/);
  });

  it("refuses context from an event that cannot add any", () => {
    expect(() =>
      assertMcpServers([
        row({ hooks: [{ id: "late", on: "afterTurn", tool: "t", inject: true }] }),
      ]),
    ).toThrow(/mem: /);
  });

  it("still refuses a duplicate id", () => {
    expect(() => assertMcpServers([row({}), row({})])).toThrow("duplicate server id");
  });
});
