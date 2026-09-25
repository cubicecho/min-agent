import { contextBlocks, type HookOutcome } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpServerConfig, Session, StoredMessage } from "../shared/types.ts";

const runHooks = vi.fn();

vi.mock("../server/mcp.ts", () => ({ runHooks }));

const { gather, notify, turnIndex, turnMessages, withContext } = await import("../server/hooks.ts");
const { assertMcpServers } = await import("../server/config.ts");

/**
 * The half of hooks that is min-agent's own: the pool runs them, and this decides what a
 * session looks like to them, where their context lands in a request, and what the chat is told.
 *
 * The pool is mocked out. Its running of hooks is tested where it lives.
 */

const session = (messages: StoredMessage[]) => ({ id: "s1", messages }) as unknown as Session;

const transcript: StoredMessage[] = [
  { role: "user", content: "what is in /tmp?" },
  {
    role: "assistant",
    content: "",
    tool_calls: [{ id: "c1", type: "function", function: { name: "fs__ls", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: "c1", content: "a.txt\nb.txt" },
  { role: "assistant", content: "Two files." },
] as StoredMessage[];

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

beforeEach(() => runHooks.mockReset());

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
    const retried = [...transcript.slice(0, 3), { role: "assistant", content: "Three." }];
    expect(turnMessages(session(retried as StoredMessage[]), 3)[0].uuid).not.toBe(answer.uuid);
  });

  it("reads only the stretch it is asked for", () => {
    expect(turnMessages(session(transcript), 1, 3)).toEqual([]);
    expect(turnMessages(session(transcript), 3).map((message) => message.text)).toEqual([
      "Two files.",
    ]);
  });
});

describe("turnIndex", () => {
  it("counts the turns ahead of a point", () => {
    expect(turnIndex([])).toBe(0);
    expect(turnIndex(transcript)).toBe(1);
    expect(turnIndex(transcript, 0)).toBe(0);
  });
});

describe("withContext", () => {
  const question: OpenAI.ChatCompletionUserMessageParam = { role: "user", content: "now" };

  it("puts the context ahead of the question, and leaves the stored one alone", () => {
    const sent = withContext(question, '<context source="Memory">likes tea</context>');
    expect(sent.content).toContain('<context source="Memory">likes tea</context>');
    expect((sent.content as string).endsWith("now")).toBe(true);
    expect(question.content).toBe("now");
  });

  it("adds a part to a question that is already a list of parts", () => {
    const sent = withContext({ role: "user", content: [{ type: "text", text: "now" }] }, "ctx");
    const parts = sent.content as OpenAI.ChatCompletionContentPartText[];
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toContain("ctx");
    expect(parts[1].text).toBe("now");
  });

  it("returns the question as it is when there is no context", () => {
    expect(withContext(question, "")).toBe(question);
    expect(withContext(question, undefined)).toBe(question);
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
