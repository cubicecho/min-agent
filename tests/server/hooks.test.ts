import type { HookOutcome } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import { assertMcpServers } from "../../server/config.ts";
import {
  exchangeHooks,
  HOST,
  type HookPool,
  notify,
  sessionDeleted,
  withContext,
} from "../../server/hooks.ts";
import type { McpServerConfig } from "../../shared/types.ts";
import { textOf } from "../helpers.ts";
import { hookRunnerOver } from "./helpers.ts";

const runHooks = vi.fn();
/** The pool every test runs hooks on, as `server/index.ts` hands in the real one. */
const mcp: HookPool = { hookRunner: hookRunnerOver(runHooks) };

/**
 * The half of hooks that is min-agent's own: the pool runs them, and this decides what a
 * session looks like to them, where their context lands in a request, and what the chat is told.
 *
 * The pool is mocked out. Its running of hooks is tested where it lives.
 */

const outcome = (patch: Partial<HookOutcome>): HookOutcome => ({
  serverId: "mem",
  label: "Memory",
  hookId: "recall",
  event: "beforeExchange",
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

describe("exchangeHooks", () => {
  const context = { session: { id: "s1" }, prompt: "what is in /tmp?", index: 2 };

  it("has the loop fire every event it has a point for, sessionStart only on a first question", () => {
    const later = exchangeHooks(mcp, context, { first: false, turnBase: 0 });
    expect(later.fire).toEqual(["beforeExchange", "beforeCompact", "afterExchange"]);
    const first = exchangeHooks(mcp, context, { first: true, turnBase: 0 });
    expect(first.fire).toEqual([
      "sessionStart",
      "beforeExchange",
      "beforeCompact",
      "afterExchange",
    ]);
  });

  it("tells the hooks min-agent's name, the question as typed and its place in the chat", () => {
    const hooks = exchangeHooks(mcp, context, { first: false, turnBase: 4 });
    expect(hooks.context).toEqual({
      session: { id: "s1" },
      host: HOST,
      prompt: "what is in /tmp?",
      turn: { index: 2 },
    });
    expect(hooks.question).toBe("what is in /tmp?");
    expect(hooks.turnBase).toBe(4);
    expect(hooks.preface).toBe(PREFACE);
  });

  it("tells the chat each note as it lands, but afterExchange's, which the turn says once stored", () => {
    const emit = vi.fn();
    const { onNote } = exchangeHooks(mcp, context, { first: false, turnBase: 0, emit });
    const before = {
      event: "beforeExchange",
      source: "Memory",
      hookId: "recall",
      tokens: 3,
    } as const;
    const after = {
      event: "afterExchange",
      source: "Memory",
      hookId: "remember",
      error: "boom",
    } as const;
    onNote?.(before);
    onNote?.(after);
    expect(emit.mock.calls).toEqual([[{ type: "hook", hook: before }]]);
  });

  it("runs the hooks on the pool", async () => {
    runHooks.mockResolvedValue([]);
    const { run } = exchangeHooks(mcp, context, { first: false, turnBase: 0 });
    await run("beforeExchange", { session: { id: "s1" } }, {});
    expect(runHooks).toHaveBeenCalledTimes(1);
    expect(runHooks.mock.calls[0][0]).toBe("beforeExchange");
  });
});

describe("notify", () => {
  it("notes only the failures, and passes no signal", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "afterExchange", hookId: "remember" }),
      outcome({ event: "afterExchange", hookId: "audit", ok: false, error: "boom" }),
    ]);

    const notes = await notify(mcp, "afterExchange", { session: { id: "s1" } });

    expect(notes).toEqual([
      { event: "afterExchange", source: "Memory", hookId: "audit", error: "boom" },
    ]);
    expect(runHooks.mock.calls[0][2].signal).toBeUndefined();
  });

  it("runs the one event, tells the chat each failure once, and hands the notes back", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "afterExchange", hookId: "remember", text: "stored" }),
      outcome({ event: "afterExchange", hookId: "audit", ok: false, error: "boom" }),
      outcome({ event: "afterExchange", hookId: "index", label: "Search", ok: false }),
    ]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const context = { session: { id: "s1" }, host: HOST, reply: "Two files." };
    const emit = vi.fn();

    const notes = await notify(mcp, "afterExchange", context, emit);

    expect(notes).toEqual([
      { event: "afterExchange", source: "Memory", hookId: "audit", error: "boom" },
      { event: "afterExchange", source: "Search", hookId: "index", error: "failed" },
    ]);
    expect(emit.mock.calls).toEqual(notes.map((hook) => [{ type: "hook", hook }]));

    expect(runHooks).toHaveBeenCalledTimes(1);
    const [event, told, options] = runHooks.mock.calls[0];
    expect(event).toBe("afterExchange");
    expect(told).toBe(context);
    options.onNotice("Memory: boom");
    expect(warn).toHaveBeenCalledExactlyOnceWith("[hooks] Memory: boom");
  });

  it("has nothing to say when every hook worked", async () => {
    runHooks.mockResolvedValue([outcome({ event: "beforeCompact", text: "stored" })]);
    const emit = vi.fn();

    expect(await notify(mcp, "beforeCompact", { session: { id: "s1" } }, emit)).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });
});

describe("sessionDeleted", () => {
  it("fires sessionDelete with the chat's id and min-agent's name", async () => {
    runHooks.mockResolvedValue([
      outcome({ event: "sessionDelete", hookId: "forget", ok: false, error: "boom" }),
    ]);

    expect(await sessionDeleted(mcp, "s1")).toEqual([
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
    await expect(sessionDeleted(mcp, "s1")).resolves.toBeDefined();
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
    trustAnnotations: true,
    hooks: [],
    ...patch,
  });

  it("accepts hooks the pool can run", () => {
    expect(() =>
      assertMcpServers([
        row({
          hooks: [
            {
              id: "recall",
              on: "beforeExchange",
              tool: "recall",
              inject: true,
              args: "{{prompt}}",
            },
          ],
        }),
      ]),
    ).not.toThrow();
  });

  it("refuses a hook that asks for what its event never has, naming the row", () => {
    expect(() =>
      assertMcpServers([
        row({
          hooks: [{ id: "early", on: "beforeExchange", tool: "t", args: { a: "{{reply}}" } }],
        }),
      ]),
    ).toThrow(/^mem: .*reply/);
  });

  it("refuses context from an event that cannot add any", () => {
    expect(() =>
      assertMcpServers([
        row({ hooks: [{ id: "late", on: "afterExchange", tool: "t", inject: true }] }),
      ]),
    ).toThrow(/mem: /);
  });

  it("still refuses a duplicate id", () => {
    expect(() => assertMcpServers([row({}), row({})])).toThrow("duplicate server id");
  });
});
