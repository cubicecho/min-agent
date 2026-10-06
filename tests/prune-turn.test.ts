import { resetAll } from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
  type StreamEvent,
} from "../shared/types.ts";

/**
 * Pruning as a turn does it, read off the requests themselves: what the endpoint is posted on each
 * step, whether it is the last request with only its tail added, and what is stored and shown
 * while that happens.
 *
 * The harness is `run-turn.test.ts`'s, with `compact-turn.test.ts`'s summariser beside it: the
 * endpoint is a `fetch` that records each body exactly as it was serialised and answers from a
 * script, and the pool, the store and the settings are mocked.
 */

const BASE_URL = "http://box:8080/v1";
const NOW = "2026-01-01T00:00:00.000Z";

let settings: LlmConfig;
let offered: ToolDefinition[] = [];

const mcp = {
  catalog: vi.fn(),
  tools: vi.fn(),
  instructions: vi.fn(),
  resourceServers: vi.fn(),
  call: vi.fn(),
  runHooks: vi.fn(),
};

/** Every row `addMessage` was handed, as it was at that moment. */
let stored: StoredMessage[] = [];
/** Every `updateSession` patch, in order. */
let updates: Record<string, unknown>[] = [];

vi.mock("../server/mcp.ts", () => mcp);
vi.mock("../server/store.ts", () => ({
  addMessage: async (_session: string, idx: number, message: StoredMessage) => {
    stored[idx] = structuredClone(message);
    return `row-${idx}`;
  },
  patchMessage: async () => {},
  updateSession: async (_session: string, patch: Record<string, unknown>) => {
    updates.push(structuredClone(patch));
  },
}));
vi.mock("../server/config.ts", async (original) => ({
  ...(await original<typeof import("../server/config.ts")>()),
  loadLlmConfig: () => settings,
}));

const { runTurn } = await import("../server/agent.ts");

type Usage = { prompt_tokens: number; completion_tokens: number; total_tokens: number };
type Reply = { chunks: object[] };

/** What the chat model will answer, in order; what the summariser will; and every body posted. */
let script: Reply[] = [];
let summaries: string[] = [];
let requests: string[] = [];

const chunk = (delta: object, finish: string | null = null) => ({
  id: "chunk",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const USAGE: Usage = { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 };

/** A turn that says `text` and stops. */
const says = (text: string, usage: object = USAGE): Reply => ({
  chunks: [chunk({ content: text }), chunk({}, "stop"), { choices: [], usage }],
});

/** A turn that asks for one tool and says nothing. */
const asks = (id: string, name: string, args: string, usage: object = USAGE): Reply => ({
  chunks: [
    chunk({
      tool_calls: [{ index: 0, id, type: "function", function: { name, arguments: args } }],
    }),
    chunk({}, "tool_calls"),
    { choices: [], usage },
  ],
});

/**
 * The endpoint. A streamed request is the chat model's and is answered from the script; one that
 * is not streamed is the summariser's. Anything else — the question of how large the window is —
 * is a 404, and is not kept.
 */
async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!String(url).endsWith("/chat/completions")) {
    return new Response("{}", { status: 404 });
  }
  const raw = String(init?.body);
  requests.push(raw);
  const body = JSON.parse(raw) as Record<string, unknown>;

  if (!body.stream) {
    return new Response(
      JSON.stringify({
        id: "summary",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: summaries.shift() ?? "" },
            finish_reason: "stop",
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const reply = script.shift();
  if (!reply) {
    return new Response("{}", { status: 404 });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const each of reply.chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(each)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

type Sent = { role: string; content: unknown; tool_call_id?: string };
type Body = { messages: Sent[]; tools?: ToolDefinition[]; stream?: boolean; model: string };

/** The chat model's requests, parsed, in the order they were posted. */
const chatted = () =>
  requests.map((raw) => JSON.parse(raw) as Body).filter((body) => body.stream === true);

/** Each message of a request as it was serialised, so two requests compare byte for byte. */
const wire = (body: Body) => body.messages.map((message) => JSON.stringify(message));

/** How many leading messages two requests share. */
const shared = (a: string[], b: string[]) => {
  let at = 0;
  while (at < a.length && at < b.length && a[at] === b[at]) {
    at++;
  }
  return at;
};

/**
 * Whether `next` is `previous` with only a tail added — as the endpoint's cache sees it, which is
 * the serialised text and not a list of messages: everything up to the end of `previous`'s last
 * message is found again at the front of `next`.
 */
const extendsExactly = (previous: Body, next: Body) => {
  const before = JSON.stringify(previous.messages);
  return (
    next.messages.length > previous.messages.length &&
    JSON.stringify(next.messages).startsWith(`${before.slice(0, -1)},`)
  );
};

/** The results a request carries, in order. */
const resultsOf = (body: Body) =>
  body.messages.filter((message) => message.role === "tool").map((message) => message.content);

/** A window in which three cleared 2000-character results pass the threshold and two do not. */
const WINDOW = 4000;

const configure = (patch: Partial<LlmConfig> = {}) => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    systemPrompt: "Be brief.",
    contextLimit: WINDOW,
    toolDiscovery: "eager",
    ...patch,
  });
};

const READ: ToolDefinition = {
  type: "function",
  function: {
    name: "fs__read",
    description: `Read a file. ${"Paths are absolute. ".repeat(20)}`,
    parameters: { type: "object", properties: { path: { type: "string" } } },
  },
};

/** What reading `/n` returns: 2000 characters, recognisable. */
const file = (n: number | string) => `file ${n} ${"x".repeat(2000 - `file ${n} `.length)}`;

/** The stub that stands in for a 2000-character result. */
const STUB = "[result cleared, 2,000 chars]";

/** `count` steps that each read the next file, numbered from `from`, then an answer. */
const reads = (count: number, from = 0, name = "fs__read") => [
  ...Array.from({ length: count }, (_, at) =>
    asks(
      `c${from + at}`,
      name,
      name === "call_tool"
        ? JSON.stringify({ name: "fs__read", arguments: { path: `/${from + at}` } })
        : JSON.stringify({ path: `/${from + at}` }),
    ),
  ),
  says("Done."),
];

const session = (patch: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "A chat",
  createdAt: NOW,
  updatedAt: NOW,
  messages: [],
  ...patch,
});

async function run(chat: Session, prompt: string) {
  const events: StreamEvent[] = [];
  const stats = await runTurn({
    session: chat,
    prompt,
    onEvent: (event) => events.push(structuredClone(event)),
  });
  return { events, stats };
}

/** Every marker the turn stored, in order. */
const markers = () =>
  updates.flatMap((patch) => ("pruning" in patch ? [patch.pruning as { through: number }] : []));

/** Where the tool results are in a transcript. */
const resultRows = (messages: StoredMessage[]) =>
  messages.flatMap((message, at) => (message.role === "tool" ? [at] : []));

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(NOW));
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  script = [];
  summaries = [];
  requests = [];
  stored = [];
  updates = [];
  offered = [READ];
  configure();

  for (const mock of Object.values(mcp)) {
    mock.mockReset();
  }
  mcp.catalog.mockImplementation(() => [
    {
      id: "fs",
      label: "Files",
      tools: offered.map(({ function: fn }) => ({
        name: fn.name,
        description: fn.description ?? "",
      })),
    },
  ]);
  mcp.tools.mockImplementation((names?: string[]) =>
    names
      ? names.flatMap((name) => offered.filter((each) => each.function.name === name))
      : offered,
  );
  mcp.instructions.mockReturnValue([]);
  mcp.resourceServers.mockReturnValue([]);
  mcp.runHooks.mockResolvedValue([]);
  mcp.call.mockImplementation(async (_name: string, args: { path: string }) =>
    file(args.path.slice(1)),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a long turn of tool steps", () => {
  it("sends each request as the last one extended, but for the two steps the marker moves on", async () => {
    script = reads(12);
    const chat = session();

    const { events, stats } = await run(chat, "read them all");

    const sent = chatted();
    expect(sent).toHaveLength(13);
    const rows = resultRows(chat.messages);

    // The marker moved twice in twelve steps: once three results had gathered behind the latest
    // five, and again once three more had. Each time onto the fifth result from the end.
    expect(markers()).toEqual([
      { through: rows[3], at: NOW },
      { through: rows[6], at: NOW },
    ]);
    expect(chat.pruning).toEqual({ through: rows[6], at: NOW });

    // Request n is posted after n results. The marker moved after the eighth and the eleventh.
    const moved = new Map([
      // Nothing was cleared before, so the first stub is the first result: stored index 2, and one
      // further into the request for the system message ahead of it.
      [8, rows[0] + 1],
      // From the old marker onward, and not a message before it.
      [11, rows[3] + 1],
    ]);
    for (let at = 1; at < sent.length; at++) {
      const differsAt = moved.get(at);
      if (differsAt === undefined) {
        expect(extendsExactly(sent[at - 1], sent[at]), `request ${at} extends ${at - 1}`).toBe(
          true,
        );
      } else {
        expect(shared(wire(sent[at - 1]), wire(sent[at])), `request ${at}`).toBe(differsAt);
      }
    }
    // The head the cache keys on first is the same on every step too.
    expect(new Set(sent.map((body) => JSON.stringify(body.tools))).size).toBe(1);
    expect(new Set(sent.map((body) => JSON.stringify(body.messages[0]))).size).toBe(1);

    // What the model was sent, at the three states the turn went through.
    expect(resultsOf(sent[7])).toEqual([0, 1, 2, 3, 4, 5, 6].map(file));
    expect(resultsOf(sent[8])).toEqual([STUB, STUB, STUB, ...[3, 4, 5, 6, 7].map(file)]);
    expect(resultsOf(sent[10])).toEqual([STUB, STUB, STUB, ...[3, 4, 5, 6, 7, 8, 9].map(file)]);
    expect(resultsOf(sent[12])).toEqual([
      ...Array(6).fill(STUB),
      ...[6, 7, 8, 9, 10, 11].map(file),
    ]);

    // What was stored and what the chat was shown: every result whole, as before there were stubs.
    expect(rows.map((at) => stored[at].content)).toEqual(
      Array.from({ length: 12 }, (_, n) => file(n)),
    );
    expect(rows.map((at) => chat.messages[at].content)).toEqual(
      Array.from({ length: 12 }, (_, n) => file(n)),
    );
    expect(
      events.flatMap((event) => (event.type === "tool_result" ? [event.content] : [])),
    ).toEqual(Array.from({ length: 12 }, (_, n) => file(n)));

    // And the readout is of the request with its stubs in: nine parts that add up to the prompt
    // the endpoint reported, and beside them what the six stubs stand in for.
    const { cleared, ...parts } = stats.breakdown ?? {};
    expect(Object.values(parts).reduce((sum, part) => sum + (part ?? 0), 0)).toBe(100);
    const last = sent[12];
    const requestChars =
      (last.messages[0].content as string).length +
      JSON.stringify(last.tools).length +
      last.messages.slice(1).reduce((sum, message) => sum + JSON.stringify(message).length, 0);
    const clearedChars = 6 * (JSON.stringify(file(0)).length - JSON.stringify(STUB).length);
    expect(cleared).toBe(Math.round((clearedChars / requestChars) * 100));
    expect(cleared).toBeGreaterThan(30);
  });

  it("gives the next turn the last request as its prefix, and holds the marker there", async () => {
    script = [...reads(12), ...reads(2, 12)];
    const chat = session();
    await run(chat, "read them all");
    const before = chatted();
    const marker = structuredClone(chat.pruning);

    await run(chat, "and two more");

    const after = chatted().slice(before.length);
    expect(after).toHaveLength(3);
    // Across the turn boundary: the last request, the answer to it, and the new question.
    expect(extendsExactly(before[before.length - 1], after[0])).toBe(true);
    expect(after[0].messages.slice(-2)).toEqual([
      { role: "assistant", content: "Done." },
      { role: "user", content: "and two more" },
    ]);
    // One result behind the latest five at the start, three by the end: the marker holds through
    // the first two requests and steps once the second read is in.
    expect(extendsExactly(after[0], after[1])).toBe(true);
    const rows = resultRows(chat.messages);
    expect(markers().slice(2)).toEqual([{ through: rows[9], at: NOW }]);
    expect(shared(wire(after[1]), wire(after[2]))).toBe((marker?.through ?? 0) + 1);
  });

  it("leaves the transcript whole in a window too large for the results to matter", async () => {
    configure({ contextLimit: 200_000 });
    script = reads(12);
    const chat = session();

    const { stats } = await run(chat, "read them all");

    const sent = chatted();
    for (let at = 1; at < sent.length; at++) {
      expect(extendsExactly(sent[at - 1], sent[at])).toBe(true);
    }
    expect(resultsOf(sent[12])).toEqual(Array.from({ length: 12 }, (_, n) => file(n)));
    expect(markers()).toEqual([]);
    expect(chat.pruning).toBeUndefined();
    expect(stats.breakdown).not.toHaveProperty("cleared");
  });

  it("never moves the marker on its own when the window is unknown", async () => {
    configure({ contextLimit: 0 });
    script = reads(12);
    const chat = session();

    await run(chat, "read them all");

    const sent = chatted();
    expect(sent).toHaveLength(13);
    for (let at = 1; at < sent.length; at++) {
      expect(extendsExactly(sent[at - 1], sent[at])).toBe(true);
    }
    expect(markers()).toEqual([]);
    expect(chat.pruning).toBeUndefined();
  });

  it("does not report the miss a move causes as the server's", async () => {
    // Every request finds the last one cached, but for the one after the marker moved.
    const cached = (hit: number) => ({
      prompt_tokens: 1000,
      completion_tokens: 10,
      total_tokens: 1010,
      prompt_tokens_details: { cached_tokens: hit },
    });
    script = reads(9).map((reply, at) => ({
      chunks: [...reply.chunks.slice(0, -1), { choices: [], usage: cached(at === 8 ? 100 : 990) }],
    }));

    await run(session(), "read them all");

    expect(markers()).toHaveLength(1);
    expect(warn.mock.calls.flat().join("\n")).not.toContain("prompt cache missed");
  });

  it("still reports a miss the marker had nothing to do with", async () => {
    const cached = (hit: number) => ({
      prompt_tokens: 1000,
      completion_tokens: 10,
      total_tokens: 1010,
      prompt_tokens_details: { cached_tokens: hit },
    });
    script = reads(4).map((reply, at) => ({
      chunks: [...reply.chunks.slice(0, -1), { choices: [], usage: cached(at === 3 ? 100 : 990) }],
    }));

    await run(session(), "read them all");

    expect(markers()).toEqual([]);
    expect(warn.mock.calls.flat().join("\n")).toContain("prompt cache missed: 100 of 1000 cached");
  });
});

describe("a session from before there were markers", () => {
  /** Two finished turns of four reads each, stored whole, with nothing said about pruning. */
  const legacy = (): StoredMessage[] =>
    [0, 4].flatMap((from) => [
      { role: "user", content: `question ${from}` },
      ...Array.from({ length: 4 }, (_, at) => [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            {
              id: `old-${from + at}`,
              type: "function",
              function: { name: "fs__read", arguments: `{"path":"/${from + at}"}` },
            },
          ],
        },
        { role: "tool", tool_call_id: `old-${from + at}`, content: file(from + at) },
      ]).flat(),
      { role: "assistant", content: "Done." },
    ]) as StoredMessage[];

  it("is sent exactly as it is stored while the rule has not fired", async () => {
    configure({ contextLimit: 200_000 });
    script = [says("Fine.")];
    const messages = legacy();
    const chat = session({ messages });
    const before = structuredClone(messages);

    const { stats } = await run(chat, "and now?");

    expect(chatted()[0].messages).toEqual([
      { role: "system", content: "Be brief." },
      ...before,
      { role: "user", content: "and now?" },
    ]);
    expect(markers()).toEqual([]);
    expect(chat.pruning).toBeUndefined();
    expect(stats.breakdown).not.toHaveProperty("cleared");
  });

  it("gets its first marker at the start of the turn that finds it over the threshold", async () => {
    script = [says("Fine."), says("Still fine.")];
    const chat = session({ messages: legacy() });
    const rows = resultRows(chat.messages);
    const before = structuredClone(chat.messages);

    const { stats } = await run(chat, "and now?");

    // Eight results, three of them behind the latest five: enough, in this window.
    expect(markers()).toEqual([{ through: rows[3], at: NOW }]);
    expect(resultsOf(chatted()[0])).toEqual([STUB, STUB, STUB, ...[3, 4, 5, 6, 7].map(file)]);
    expect(chat.messages.slice(0, before.length)).toEqual(before);
    expect(stats.breakdown?.cleared).toBeGreaterThan(0);

    // And from then on it is as stable as any other.
    await run(chat, "sure?");
    const [first, second] = chatted();
    expect(extendsExactly(first, second)).toBe(true);
    expect(markers()).toHaveLength(1);
  });
});

describe("a turn that compacts", () => {
  /** 400 characters, so 100 tokens by the planner's count. */
  const long = (tag: string) => `${tag} ${"x".repeat(400 - tag.length - 1)}`;

  /**
   * A bulky first turn, then one of six short tool steps that fits the kept tail whole. The
   * results are 400 characters: long enough to be cleared, far too few to pass the threshold.
   */
  const transcript = (): StoredMessage[] =>
    [
      { role: "user", content: long("q0") },
      ...Array.from({ length: 12 }, (_, at) => ({
        role: "assistant",
        content: long(`a0-${at}`),
      })),
      { role: "user", content: long("q1") },
      ...Array.from({ length: 6 }, (_, at) => [
        {
          role: "assistant",
          content: null,
          tool_calls: [
            { id: `t${at}`, type: "function", function: { name: "fs__read", arguments: "{}" } },
          ],
        },
        { role: "tool", tool_call_id: `t${at}`, content: long(`r${at}`) },
      ]).flat(),
      {
        role: "assistant",
        content: long("a1"),
        stats: { model: "m", contextTokens: 3500, lastPromptTokens: 3400 },
      },
    ] as StoredMessage[];

  it("moves the marker with the fold, for a saving that would not have moved it alone", async () => {
    configure({ taskModels: { compaction: "small" } });
    summaries = ["the notes"];
    script = [says("Fine."), says("Still fine.")];
    const chat = session({ messages: transcript() });
    const rows = resultRows(chat.messages);

    await run(chat, "and now?");

    // The fold ends where the second turn begins, and the marker lands on the fifth result from
    // the end: one result cleared, a fortieth of the window.
    expect(chat.compaction).toEqual({ summary: "the notes", through: 13, at: NOW });
    expect(markers()).toEqual([{ through: rows[1], at: NOW }]);
    const order = updates.flatMap((patch) =>
      "compaction" in patch ? ["compaction"] : "pruning" in patch ? ["pruning"] : [],
    );
    expect(order).toEqual(["compaction", "pruning"]);

    const [first] = chatted();
    expect(first.messages[1].role).toBe("system");
    expect(first.messages[1].content).toContain("the notes");
    expect(resultsOf(first)).toEqual([
      "[result cleared, 400 chars]",
      ...[1, 2, 3, 4, 5].map((at) => long(`r${at}`)),
    ]);

    // Stable after: the next turn's request is this one with its tail added.
    await run(chat, "sure?");
    const [, second] = chatted();
    expect(extendsExactly(first, second)).toBe(true);
    expect(markers()).toHaveLength(1);
  });

  it("leaves the marker where it is when the same transcript is not folded", async () => {
    script = [says("Fine.")];
    const chat = session({ messages: transcript() });

    await run(chat, "and now?");

    expect(chat.compaction).toBeUndefined();
    expect(markers()).toEqual([]);
    expect(resultsOf(chatted()[0])).toEqual([0, 1, 2, 3, 4, 5].map((at) => long(`r${at}`)));
  });
});

describe("a proxied turn", () => {
  it("keeps the loaded definitions whole behind the marker, and the tool callable", async () => {
    configure({ toolDiscovery: "proxy" });
    script = [asks("load", "load_tools", '{"names":["fs__read"]}'), ...reads(9, 0, "call_tool")];
    const chat = session();

    await run(chat, "read them all");

    const sent = chatted();
    expect(sent).toHaveLength(11);
    const rows = resultRows(chat.messages);
    const definitions = chat.messages[rows[0]].content as string;
    // The only copy of the schema the model has, and long enough to have been cleared.
    expect(definitions.startsWith("Loaded 1 tool(s). Run them with `call_tool`.")).toBe(true);
    expect(definitions).toContain(JSON.stringify(READ.function.parameters));
    expect(definitions.length).toBeGreaterThan(256);

    // Nine results in — the load and eight reads — three reads lie behind the latest five.
    expect(markers()).toEqual([{ through: rows[4], at: NOW }]);
    expect(rows[0]).toBeLessThan(rows[4]);

    // The request after the move: the definitions as they were, the three reads as stubs.
    expect(resultsOf(sent[9])).toEqual([
      definitions,
      STUB,
      STUB,
      STUB,
      ...[3, 4, 5, 6, 7].map(file),
    ]);
    // Still declared, and the call made after the move ran against the real tool.
    expect(sent[9].tools?.map((tool) => tool.function.name)).toEqual(["load_tools", "call_tool"]);
    expect(mcp.call.mock.calls).toHaveLength(9);
    expect(mcp.call.mock.calls[8].slice(0, 2)).toEqual(["fs__read", { path: "/8" }]);
    expect(chat.messages[rows[9]].content).toBe(file(8));
    // The move changed the request from the first read, not from the load before it.
    expect(shared(wire(sent[8]), wire(sent[9]))).toBe(rows[1] + 1);
  });
});
