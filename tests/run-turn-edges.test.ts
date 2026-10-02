import { type CatalogServer, resetAll } from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
  type StreamEvent,
  type TurnStats,
} from "../shared/types.ts";

/**
 * The edges of `runTurn`'s loop that `run-turn.test.ts` leaves alone: what a stop does at each
 * point a turn can be stopped, the order things are written and said in, what a turn that ends
 * badly leaves stored, and the arguments a model gets wrong in ways other than a syntax error.
 *
 * Characterization, like that file: a value here is what the code does. These are the places a
 * replacement loop (#52) is most likely to differ without anything else noticing, so each one a
 * swap moves is a difference to be named, not a test to be quietly rewritten.
 *
 * The harness is that file's, with one addition: `log`, a single ordered record of what was
 * posted, stored, called and emitted, so "before" and "after" can be read off one list.
 */

const BASE_URL = "http://box:8080/v1";

let settings: LlmConfig;
let offered: ToolDefinition[] = [];

const mcp = {
  catalog: vi.fn(),
  tools: vi.fn(),
  instructions: vi.fn(),
  resourceServers: vi.fn(),
  call: vi.fn(),
  client: vi.fn(),
  runHooks: vi.fn(),
};

/** Every row `addMessage` was handed, as it was at that moment. */
let stored: StoredMessage[] = [];
/** Every `patchMessage`, by the row it was for. */
let patches: { row: string }[] = [];
/** Every `updateSession` patch, in order. */
let updates: Record<string, unknown>[] = [];
/** Everything that happened, in the order it happened. */
let log: string[] = [];
/** Called as each row is written, before the write resolves. */
let onStore: (message: StoredMessage) => void = () => {};

vi.mock("../server/mcp.ts", () => mcp);
vi.mock("../server/store.ts", () => ({
  addMessage: async (_session: string, idx: number, message: StoredMessage) => {
    stored[idx] = structuredClone(message);
    log.push(`store ${message.role}${message.role === "tool" ? ` ${message.tool_call_id}` : ""}`);
    onStore(message);
    return `row-${idx}`;
  },
  patchMessage: async (row: string) => {
    patches.push({ row });
  },
  updateSession: async (_session: string, patch: Record<string, unknown>) => {
    updates.push(structuredClone(patch));
  },
}));
vi.mock("../server/config.ts", async (original) => ({
  ...(await original<typeof import("../server/config.ts")>()),
  loadLlmConfig: () => settings,
}));

const { runTurn } = await import("../server/agent.ts");

type Reply = { chunks: object[] } | { refusal: string };

let script: Reply[] = [];
let requests: string[] = [];

const chunk = (delta: object, finish: string | null = null) => ({
  id: "chunk",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

const USAGE = {
  choices: [],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
};

/** A turn that says `text` and ends for `finish`. */
const says = (text: string, finish = "stop"): Reply => ({
  chunks: [chunk({ content: text }), chunk({}, finish), USAGE],
});

/** A turn that asks for each `[id, name, arguments]` together, and ends for `finish`. */
const asksFor = (finish: string, ...calls: [id: string, name: string, args: string][]): Reply => ({
  chunks: [
    chunk({
      tool_calls: calls.map(([id, name, args], index) => ({
        index,
        id,
        type: "function",
        function: { name, arguments: args },
      })),
    }),
    chunk({}, finish),
    USAGE,
  ],
});

const asks = (...calls: [id: string, name: string, args: string][]) =>
  asksFor("tool_calls", ...calls);

/** A request refused outright, with the endpoint's reason as the `error.message` of a 400. */
const refuses = (refusal: string): Reply => ({ refusal });

async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  requests.push(String(init?.body ?? url));
  log.push("request");
  const reply = String(url).endsWith("/chat/completions") ? script.shift() : undefined;
  if (!reply) return new Response("{}", { status: 404 });
  if ("refusal" in reply)
    return new Response(JSON.stringify({ error: { message: reply.refusal } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const each of reply.chunks)
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(each)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

const bodies = () => requests.map((raw) => JSON.parse(raw) as Record<string, unknown>);

const declared = (body: Record<string, unknown>) =>
  ((body.tools as ToolDefinition[] | undefined) ?? []).map((tool) => tool.function.name);

const tool = (name: string, description: string, properties = {}): ToolDefinition => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties } },
});

const READ = tool("fs__read", "Read a file", { path: { type: "string" } });
const LS = tool("fs__ls", "List a directory", { path: { type: "string" } });
const NOW = tool("clock__now", "The time");

function catalog(): CatalogServer[] {
  const servers = new Map<string, CatalogServer>();
  for (const { function: fn } of offered) {
    const id = fn.name.split("__")[0];
    const server = servers.get(id) ?? { id, label: id === "fs" ? "Files" : "Clock", tools: [] };
    server.tools.push({ name: fn.name, description: fn.description ?? "" });
    servers.set(id, server);
  }
  return [...servers.values()];
}

const configure = (patch: Partial<LlmConfig> = {}) => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    systemPrompt: "Be brief.",
    contextLimit: 32_768,
    toolDiscovery: "eager",
    ...patch,
  });
};

const session = (patch: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "A chat",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messages: [],
  ...patch,
});

async function run(
  chat: Session,
  prompt: string,
  { onEvent, signal }: { onEvent?: (event: StreamEvent) => void; signal?: AbortSignal } = {},
) {
  const events: StreamEvent[] = [];
  const settled: { stats?: TurnStats; error?: Error } = await runTurn({
    session: chat,
    prompt,
    signal,
    onEvent: (event) => {
      events.push(structuredClone(event));
      if (event.type === "tool_use") log.push(`tool_use ${event.id}`);
      if (event.type === "tool_result") log.push(`tool_result ${event.toolUseId}`);
      onEvent?.(event);
    },
  }).then(
    (stats) => ({ stats }),
    (error: unknown) => ({ error: error as Error }),
  );
  return { events, ...settled };
}

/** The `tool_result` events, as `[id, content, isError]`. */
const results = (events: StreamEvent[]) =>
  events.flatMap((event) =>
    event.type === "tool_result" ? [[event.toolUseId, event.content, event.isError]] : [],
  );

/** Every marker the turn stored, in order. */
const markers = () =>
  updates.flatMap((patch) => ("pruning" in patch ? [patch.pruning as { through: number }] : []));

/** A tool call as a stored assistant message carries it. */
const call = (id: string, name: string, args: string) => ({
  id,
  type: "function",
  function: { name, arguments: args },
});

/** A pool call that ends only when the turn's signal does, the way a stopped call is reported. */
const untilStopped = (signal: AbortSignal) =>
  new Promise<string>((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("stopped by the reader")));
  });

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  script = [];
  requests = [];
  stored = [];
  patches = [];
  updates = [];
  log = [];
  onStore = () => {};
  offered = [];
  configure();

  for (const mock of Object.values(mcp)) mock.mockReset();
  mcp.catalog.mockImplementation(catalog);
  mcp.tools.mockImplementation((names?: string[]) =>
    names
      ? names.flatMap((name) => offered.filter((each) => each.function.name === name))
      : offered,
  );
  mcp.instructions.mockReturnValue([]);
  mcp.resourceServers.mockReturnValue([]);
  mcp.runHooks.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the order a tool step is written and said in", () => {
  it("stores the reply before announcing its calls, and every result before the next request", async () => {
    offered = [READ, LS];
    mcp.call.mockImplementation(async (name: string) => {
      log.push(`call ${name}`);
      return name;
    });
    script = [
      asks(["c1", "fs__read", '{"path":"/a"}'], ["c2", "fs__ls", '{"path":"/"}']),
      says("Done."),
    ];

    await run(session(), "look");

    expect(log).toEqual([
      "store user",
      "request",
      "store assistant",
      "tool_use c1",
      "call fs__read",
      "tool_use c2",
      "call fs__ls",
      "tool_result c1",
      "tool_result c2",
      "store tool c1",
      "store tool c2",
      "request",
      "store assistant",
    ]);
  });
});

describe("stopping a turn while its tools run", () => {
  it("lets every call in flight answer, and stores each answer in call order", async () => {
    offered = [READ, LS, NOW];
    const controller = new AbortController();
    mcp.call.mockImplementation((name: string, _input: unknown, signal: AbortSignal) => {
      // One is back before the stop; the other two are ended by it.
      if (name === "clock__now") return Promise.resolve("12:00");
      return untilStopped(signal);
    });
    script = [
      asks(["c1", "fs__read", '{"path":"/a"}'], ["c2", "clock__now", "{}"], ["c3", "fs__ls", "{}"]),
      says("never asked for"),
    ];

    const { events, error } = await run(session(), "look", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool_use" && event.id === "c3") setTimeout(() => controller.abort(), 0);
      },
    });

    expect(error).toBeInstanceOf(Error);
    expect(requests).toHaveLength(1);
    expect(mcp.call).toHaveBeenCalledTimes(3);
    expect(results(events)).toEqual([
      ["c2", "12:00", false],
      ["c1", "stopped by the reader", true],
      ["c3", "stopped by the reader", true],
    ]);
    expect(stored).toEqual([
      { role: "user", content: "look" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          call("c1", "fs__read", '{"path":"/a"}'),
          call("c2", "clock__now", "{}"),
          call("c3", "fs__ls", "{}"),
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "stopped by the reader" },
      { role: "tool", tool_call_id: "c2", content: "12:00" },
      { role: "tool", tool_call_id: "c3", content: "stopped by the reader" },
    ]);
    // Cut off, not ended: no stats and no `done`.
    expect(patches).toEqual([]);
    expect(events.map(({ type }) => type)).not.toContain("done");
  });

  /**
   * The stop lands while the reply is being written, before any of its calls has started. The
   * calls are made all the same, each handed a signal that is already aborted, and what they
   * answer is what is stored.
   */
  it("still makes the calls of a reply the stop arrived behind", async () => {
    offered = [LS];
    const controller = new AbortController();
    mcp.call.mockImplementation(async (_name: string, _input: unknown, signal: AbortSignal) =>
      signal.aborted ? "ran after the stop" : "ran before it",
    );
    onStore = (message) => {
      if (message.role === "assistant") controller.abort();
    };
    script = [asks(["c1", "fs__ls", "{}"]), says("never asked for")];

    const { events, error } = await run(session(), "look", { signal: controller.signal });

    expect(error).toBeInstanceOf(Error);
    expect(requests).toHaveLength(1);
    expect(mcp.call).toHaveBeenCalledTimes(1);
    expect(events).toEqual([
      { type: "tool_use", id: "c1", name: "fs__ls", input: "{}" },
      { type: "tool_result", toolUseId: "c1", content: "ran after the stop", isError: false },
    ]);
    expect(stored.slice(2)).toEqual([
      { role: "tool", tool_call_id: "c1", content: "ran after the stop" },
    ]);
  });
});

describe("stopping a turn between steps", () => {
  it("sends nothing further, and keeps the step that had finished", async () => {
    offered = [LS];
    const controller = new AbortController();
    mcp.call.mockResolvedValue("a.txt");
    // Once the step's last result is written: nothing is in flight, and the next request has not
    // been built.
    onStore = (message) => {
      if (message.role === "tool") controller.abort();
    };
    script = [asks(["c1", "fs__ls", "{}"]), says("never asked for")];

    const { events, error } = await run(session(), "look", { signal: controller.signal });

    expect(error).toBeInstanceOf(Error);
    // The client's own abort, from the request it was not allowed to open. `server/turns.ts` drops
    // whatever a stopped turn throws, so no reader sees which error this is.
    expect([error?.constructor.name, error?.message]).toEqual([
      "APIUserAbortError",
      "Request was aborted.",
    ]);
    expect(requests).toHaveLength(1);
    expect(events).toEqual([
      { type: "tool_use", id: "c1", name: "fs__ls", input: "{}" },
      { type: "tool_result", toolUseId: "c1", content: "a.txt", isError: false },
    ]);
    expect(stored).toEqual([
      { role: "user", content: "look" },
      { role: "assistant", content: null, tool_calls: [call("c1", "fs__ls", "{}")] },
      { role: "tool", tool_call_id: "c1", content: "a.txt" },
    ]);
    expect(patches).toEqual([]);
  });
});

describe("a turn that ends on the step after a long load", () => {
  const many = Array.from({ length: 12 }, (_, index) =>
    tool(`fs__tool_${index}`, `${"Describes itself at length. ".repeat(8)}(${index})`),
  );

  it("has stored the load's whole answer when the iteration cap ends it", async () => {
    configure({ toolDiscovery: "ondemand", maxToolIterations: 1 });
    offered = many;
    script = [asks(["c1", "load_tools", '{"names":["fs__tool_*"]}']), says("never asked for")];
    const chat = session();

    const { events, error } = await run(chat, "get ready");

    expect(error?.message).toBe("Stopped after 1 tool iterations.");
    const [[, content]] = results(events);
    expect(String(content).length).toBeGreaterThan(2000);
    expect(String(content).endsWith("(11)")).toBe(true);
    expect(stored[2]).toEqual({ role: "tool", tool_call_id: "c1", content });
    // A turn that did not end carries nothing forward.
    expect(chat.loadedTools).toBeUndefined();
  });

  it("has stored the load's whole answer when a stop ends it", async () => {
    configure({ toolDiscovery: "ondemand" });
    offered = many;
    const controller = new AbortController();
    script = [asks(["c1", "load_tools", '{"names":["fs__tool_*"]}']), says("never asked for")];

    const { events, error } = await run(session(), "get ready", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool_result") controller.abort();
      },
    });

    expect(error).toBeInstanceOf(Error);
    expect(requests).toHaveLength(1);
    const [[, content]] = results(events);
    expect(String(content).length).toBeGreaterThan(2000);
    expect(stored[2]).toEqual({ role: "tool", tool_call_id: "c1", content });
  });
});

describe("the pruning marker at the end of a turn that did not finish", () => {
  /** What reading `/n` returns: 2000 characters, as `prune-turn.test.ts` has it. */
  const file = (n: number | string) => `file ${n} ${"x".repeat(2000 - `file ${n} `.length)}`;
  const reads = (count: number) =>
    Array.from({ length: count }, (_, at) =>
      asks([`c${at}`, "fs__read", JSON.stringify({ path: `/${at}` })]),
    );

  beforeEach(() => {
    offered = [READ];
    mcp.call.mockImplementation(async (_name: string, args: { path: string }) =>
      file(args.path.slice(1)),
    );
  });

  it("moves after the step the iteration cap ends on", async () => {
    // The eighth result is the one that earns a move in this window.
    configure({ contextLimit: 4000, maxToolIterations: 8 });
    script = [...reads(8), says("never asked for")];
    const chat = session();

    const { error } = await run(chat, "read them all");

    expect(error?.message).toBe("Stopped after 8 tool iterations.");
    expect(requests).toHaveLength(8);
    expect(markers()).toHaveLength(1);
    expect(chat.pruning).toEqual(markers()[0]);
  });

  it("moves after a step the reader stopped the turn behind", async () => {
    configure({ contextLimit: 4000 });
    const controller = new AbortController();
    script = [...reads(8), says("never asked for")];
    const chat = session();

    const { error } = await run(chat, "read them all", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "tool_result" && event.toolUseId === "c7") controller.abort();
      },
    });

    expect(error).toBeInstanceOf(Error);
    expect(requests).toHaveLength(8);
    expect(markers()).toHaveLength(1);
  });
});

describe("arguments a model gets wrong", () => {
  it("refuses a load whose arguments are almost JSON, and loads nothing", async () => {
    configure({ toolDiscovery: "ondemand" });
    offered = [READ, LS];
    script = [asks(["c1", "load_tools", "{'names': ['fs__read'],}"]), says("Sorry.")];

    const { events } = await run(session(), "get ready");

    expect(results(events)).toEqual([
      ["c1", "model produced invalid tool arguments: {'names': ['fs__read'],}", true],
    ]);
    expect(bodies().map(declared)).toEqual([["load_tools"], ["load_tools"]]);
    expect(stored[1]).toMatchObject({
      tool_calls: [call("c1", "load_tools", "{'names': ['fs__read'],}")],
    });
  });

  it("hands the pool arguments that are JSON but not an object", async () => {
    offered = [READ];
    mcp.call.mockResolvedValue("contents");
    script = [asks(["c1", "fs__read", '["/a"]']), says("Read.")];

    const { events } = await run(session(), "read it");

    expect(mcp.call.mock.calls).toEqual([["fs__read", ["/a"], undefined]]);
    expect(results(events)).toEqual([["c1", "contents", false]]);
  });

  it("says the same of arguments cut off at the reply ceiling as of any that do not parse", async () => {
    offered = [READ];
    script = [
      asksFor("length", ["c1", "fs__read", '{"path": "/a'], ["c2", "fs__read", ' {"pa']),
      says("Sorry."),
    ];

    const { events } = await run(session(), "read it");

    expect(mcp.call).not.toHaveBeenCalled();
    expect(results(events)).toEqual([
      ["c1", 'model produced invalid tool arguments: {"path": "/a', true],
      // Quoted as written, leading space and all.
      ["c2", 'model produced invalid tool arguments:  {"pa', true],
    ]);
    // Nothing is logged about a reply that ran out of room.
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a reply that ran out of room", () => {
  it("is stored as the answer, and nothing is logged about it", async () => {
    script = [says("Half an ans", "length")];

    const { stats } = await run(session(), "hi");

    expect(stats).toMatchObject({ iterations: 1 });
    expect(stored[1]).toMatchObject({ role: "assistant", content: "Half an ans" });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("a request refused on a later step", () => {
  it("ends the turn on the endpoint's own error, keeping the steps before it", async () => {
    offered = [LS];
    mcp.call.mockResolvedValue("a.txt");
    script = [asks(["c1", "fs__ls", "{}"]), refuses("the model has gone away")];

    const { error } = await run(session(), "look");

    expect(error?.name).toBe("Error");
    expect(error?.message).toBe("400 the model has gone away");
    expect(error?.constructor.name).toBe("BadRequestError");
    expect(stored.map(({ role }) => role)).toEqual(["user", "assistant", "tool"]);
    expect(patches).toEqual([]);
  });

  it("says what the turn was built to when the refusal is an overflow", async () => {
    offered = [LS];
    mcp.call.mockResolvedValue("a.txt");
    script = [
      asks(["c1", "fs__ls", "{}"]),
      refuses("This model's maximum context length is 4096 tokens."),
    ];

    const { error } = await run(session(), "look");

    expect(error?.name).toBe("ContextOverflow");
    expect(error?.message).toBe(
      "400 This model's maximum context length is 4096 tokens. — this turn was built to 32.8k " +
        "tokens, so the window in Settings → Agent is larger than what the server actually serves.",
    );
    expect(requests).toHaveLength(2);
  });
});

describe("the tools a later step declares", () => {
  /**
   * The pool is asked again on every step, so a server that connects while a turn runs is
   * declared on the turn's next request.
   */
  it("are the pool's as they stand at that step", async () => {
    offered = [LS];
    mcp.call.mockImplementation(async () => {
      offered = [LS, NOW];
      return "a.txt";
    });
    script = [asks(["c1", "fs__ls", "{}"]), says("Done.")];

    await run(session(), "look");

    expect(bodies().map(declared)).toEqual([["fs__ls"], ["fs__ls", "clock__now"]]);
  });
});
