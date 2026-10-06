import {
  type CatalogServer,
  catalogPrompt,
  LOAD_TOOLS_DEFINITION,
  resetAll,
  sanitizeTools,
} from "@cubicecho/agent-core";
import type { HookOutcome, ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
  type StreamEvent,
  type TurnStats,
} from "../../shared/types.ts";
import {
  declaredTools,
  errorOf,
  jsonBody,
  messagesOf,
  sessionOf,
  textOf,
  turnStats,
} from "../helpers.ts";

/**
 * `runTurn` as it behaves today, pinned from outside: what it posts to the endpoint, what it
 * stores, and what it tells the chat.
 *
 * Characterization, not specification. The loop is due to be replaced by agent-core's (#52), and
 * these are what has to stay put while it is — so a value here is what the code does, and where
 * that looks wrong the test says so and pins it anyway.
 *
 * Nothing real is behind it. The endpoint is a `fetch` that records each body exactly as it was
 * serialised and answers from a script; the pool, the store and the settings are mocked. No
 * tool-select model is configured anywhere, which keeps preselection out of every path here.
 */

const BASE_URL = "http://box:8080/v1";

/** The settings `loadLlmConfig` answers with. Replaced per test by `configure`. */
let settings: LlmConfig;

/** What the pool offers, in the pool's own order. Replaced per test by `offer`. */
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

/** Every row `addMessage` was handed, as it was at that moment: the message is patched later. */
let stored: StoredMessage[] = [];
/** Every `patchMessage`, by the row it was for. */
let patches: { row: string; patch: Pick<StoredMessage, "stats" | "followups"> }[] = [];
/** Every `updateSession` patch, in order. */
let updates: Record<string, unknown>[] = [];

vi.mock("../../server/mcp.ts", () => mcp);
vi.mock("../../server/store.ts", () => ({
  addMessage: async (_session: string, idx: number, message: StoredMessage) => {
    stored[idx] = structuredClone(message);
    return `row-${idx}`;
  },
  patchMessage: async (row: string, patch: Pick<StoredMessage, "stats" | "followups">) => {
    patches.push({ row, patch: structuredClone(patch) });
  },
  updateSession: async (_session: string, patch: Record<string, unknown>) => {
    updates.push(structuredClone(patch));
  },
}));
vi.mock("../../server/config.ts", async (original) => ({
  ...(await original<typeof import("../../server/config.ts")>()),
  loadLlmConfig: () => settings,
}));

const { instructionsPrompt, runTurn } = await import("../../server/agent.ts");
const { RESOURCE_TOOLS } = await import("../../server/mcp-resources.ts");
const { PROXY_TOOLS, proxyCatalogPrompt } = await import("../../server/tool-proxy.ts");

/** One scripted answer: a stream of chunks, or a 400 with the endpoint's reason. */
type Reply = { chunks: object[]; hangs?: boolean } | { refusal: string };

/** What the endpoint will answer, in order, and every body it was posted. */
let script: Reply[] = [];
let requests: string[] = [];

/**
 * @param delta What this chunk adds to the reply.
 * @param finish Why the reply ended, on the chunk that ends it.
 * @returns One streamed chunk, as an OpenAI-compatible server spells it.
 */
const chunk = (delta: object, finish: string | null = null) => ({
  id: "chunk",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/** The closing chunk `stream_options.include_usage` asks for. Every scripted turn costs the same. */
const USAGE = {
  choices: [],
  usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
};

/**
 * @param parts The reply, one delta each.
 * @returns A turn that says them and stops.
 */
const says = (...parts: string[]): Reply => ({
  chunks: [...parts.map((content) => chunk({ content })), chunk({}, "stop"), USAGE],
});

/**
 * @param calls Each call as `[id, name, arguments]`, the arguments as the model wrote them.
 * @returns A turn that asks for them together and says nothing.
 */
const asks = (...calls: [id: string, name: string, args: string][]): Reply => ({
  chunks: [
    chunk({
      tool_calls: calls.map(([id, name, args], index) => ({
        index,
        id,
        type: "function",
        function: { name, arguments: args },
      })),
    }),
    chunk({}, "tool_calls"),
    USAGE,
  ],
});

/**
 * @param parts What arrives before the endpoint goes quiet.
 * @returns A turn that never finishes, and ends only when its request is aborted.
 */
const stalls = (...parts: string[]): Reply => ({
  chunks: parts.map((content) => chunk({ content })),
  hangs: true,
});

/**
 * @param refusal The endpoint's reason, as the `error.message` of a 400.
 * @returns A request refused outright.
 */
const refuses = (refusal: string): Reply => ({ refusal });

/**
 * The endpoint. Anything but a chat completion is a 404, and is recorded all the same, so a
 * request nobody scripted shows up in `requests` rather than passing unseen.
 *
 * @param url Where the SDK posted.
 * @param init The request, whose body is the JSON exactly as it went out.
 * @returns The next scripted reply.
 */
async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  requests.push(String(init?.body ?? url));
  const reply = String(url).endsWith("/chat/completions") ? script.shift() : undefined;
  if (!reply) {
    return new Response("{}", { status: 404 });
  }
  if ("refusal" in reply) {
    return new Response(JSON.stringify({ error: { message: reply.refusal } }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const encoder = new TextEncoder();
  const signal = init?.signal;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const each of reply.chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(each)}\n\n`));
      }
      if (reply.hangs) {
        signal?.addEventListener("abort", () => controller.error(signal.reason));
        return;
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/**
 * Key order survives the parse, so `Object.keys` reads it back.
 *
 * @returns Each body posted, parsed.
 */
const bodies = () => requests.map(jsonBody);

/**
 * @param value Anything a body carries.
 * @returns It as it reads once it has been through a request body.
 */
// The assertion is the helper: a round trip through JSON hands back the same shape, less what
// JSON does not carry, and nothing but the caller's type says which shape that was.
const sent = <T>(value: T) => JSON.parse(JSON.stringify(value)) as T;

/**
 * @param name The qualified name, `<server>__<tool>`.
 * @param description What the catalogue says of it.
 * @param properties Its arguments, as JSON Schema properties.
 * @returns A tool definition as the pool hands one over.
 */
const tool = (name: string, description: string, properties = {}): ToolDefinition => ({
  type: "function",
  function: { name, description, parameters: { type: "object", properties } },
});

const READ = tool("fs__read", "Read a file", { path: { type: "string", pattern: "^/" } });
const LS = tool("fs__ls", "List a directory", { path: { type: "string" } });
const NOW = tool("clock__now", "The time");

/**
 * @returns The catalogue the pool would list for `offered`: one server per name prefix, in the
 * order each is first seen.
 */
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

/**
 * @param patch Settings that differ from the test defaults: one model, a declared window so the
 * endpoint is never asked for one, and no task models at all.
 */
const configure = (patch: Partial<LlmConfig> = {}) => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    systemPrompt: "Be brief.",
    contextLimit: 32_768,
    ...patch,
  });
};

/** @param tools What the pool offers from here on. */
const offer = (...tools: ToolDefinition[]) => {
  offered = tools;
};

/**
 * @param chat The session, which the turn writes to.
 * @param prompt What the user typed.
 * @param onEvent Called with each event after it is recorded.
 * @param signal The reader's stop.
 * @returns The events the turn emitted, and its stats or the error it ended on.
 */
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
      onEvent?.(event);
    },
  }).then(
    (stats) => ({ stats }),
    (error: unknown) => ({ error: errorOf(error) }),
  );
  return { events, ...settled };
}

/**
 * @param patch What differs from a quiet, successful `beforeTurn` hook.
 * @returns One hook's outcome, as the pool reports it.
 */
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

beforeEach(() => {
  // Only the clock, held still: every duration in `stats` is then exact, and a test that wants
  // one to be non-zero moves the clock itself.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  // The pooled client keeps the `fetch` it was built with, and an endpoint keeps what it refused.
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(console, "warn").mockImplementation(() => {});

  script = [];
  requests = [];
  stored = [];
  patches = [];
  updates = [];
  offered = [];
  configure();

  for (const mock of Object.values(mcp)) {
    mock.mockReset();
  }
  mcp.catalog.mockImplementation(catalog);
  // Caller order when names are given, as the pool keeps it; a name nothing offers is skipped.
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

describe("the request body", () => {
  it("declares every tool when eager, and sends a system message even when it is empty", async () => {
    configure({ toolDiscovery: "eager", systemPrompt: "" });
    offer(READ, LS, NOW);
    script = [says("hello")];
    const earlier: StoredMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "before", reasoning_content: "thinking", followups: ["more"] },
    ];

    await run(sessionOf({ messages: earlier }), "hi");

    // The whole request, in the order its fields are serialised.
    expect(requests).toEqual([
      JSON.stringify({
        max_tokens: 4096,
        temperature: 0.7,
        stream_options: { include_usage: true },
        model: "m",
        messages: [
          { role: "system", content: "" },
          { role: "user", content: "earlier" },
          { role: "assistant", content: "before" },
          { role: "user", content: "hi" },
        ],
        stream: true,
        // The pool's order, which is not name order, and the schemas as they were offered.
        tools: [READ, LS, NOW],
      }),
    ]);
  });

  it("sends no tools field when there is nothing to declare", async () => {
    script = [says("hello")];

    await run(sessionOf(), "hi");

    expect(Object.keys(bodies()[0])).toEqual([
      "max_tokens",
      "temperature",
      "stream_options",
      "model",
      "messages",
      "stream",
    ]);
  });

  it("declares load_tools and what was carried on demand, under the catalogue", async () => {
    configure({ reasoningEffort: "high" });
    offer(READ, LS, NOW);
    mcp.instructions.mockReturnValue([{ label: "Files", text: "Read before writing." }]);
    mcp.resourceServers.mockReturnValue([{ id: "fs", label: "Files" }]);
    script = [says("hello")];

    // Carried in the order it was loaded, which is neither name order nor the pool's.
    await run(sessionOf({ loadedTools: ["fs__read", "clock__now"] }), "hi");

    // One request, the turn's own: with no tool-select model there is no preselection to send.
    expect(requests).toHaveLength(1);
    const [body] = bodies();
    expect(Object.keys(body)).toEqual([
      "max_tokens",
      "temperature",
      "reasoning_effort",
      "stream_options",
      "model",
      "messages",
      "stream",
      "tools",
    ]);
    expect(body).toEqual({
      model: "m",
      max_tokens: 4096,
      temperature: 0.7,
      reasoning_effort: "high",
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        {
          role: "system",
          content: [
            "Be brief.",
            instructionsPrompt([{ label: "Files", text: "Read before writing." }]),
            catalogPrompt(catalog()),
          ].join("\n\n"),
        },
        { role: "user", content: "hi" },
      ],
      tools: sent(sanitizeTools([...RESOURCE_TOOLS, LOAD_TOOLS_DEFINITION, READ, NOW])),
    });
  });

  it("declares the two fixed tools when proxied, and nothing a session carried", async () => {
    configure({ toolDiscovery: "proxy" });
    offer(READ, LS, NOW);
    script = [says("hello")];

    await run(sessionOf({ loadedTools: ["fs__read"] }), "hi");

    expect(bodies()).toEqual([
      {
        model: "m",
        max_tokens: 4096,
        temperature: 0.7,
        stream: true,
        stream_options: { include_usage: true },
        messages: [
          { role: "system", content: `Be brief.\n\n${proxyCatalogPrompt(catalog())}` },
          { role: "user", content: "hi" },
        ],
        tools: sent(sanitizeTools(PROXY_TOOLS)),
      },
    ]);
  });

  it("builds the request again without each thing the endpoint or the model refuses", async () => {
    configure({ toolDiscovery: "eager", reasoningEffort: "high" });
    offer(READ);
    script = [
      refuses("failed to parse grammar"),
      refuses("unknown field: stream_options"),
      refuses("Unsupported parameter: 'reasoning_effort' is not supported with this model."),
      refuses("Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens' instead."),
      refuses("Unsupported value: 'temperature' does not support 0.7. Only the default (1)."),
      says("hello"),
    ];

    const { stats } = await run(sessionOf(), "hi");

    // One round trip, however many times it was sent.
    expect(stats?.iterations).toBe(1);
    const keys = bodies().map((body) => Object.keys(body).join(" "));
    expect(keys).toEqual([
      "max_tokens temperature reasoning_effort stream_options model messages stream tools",
      "max_tokens temperature reasoning_effort stream_options model messages stream tools",
      "max_tokens temperature reasoning_effort model messages stream tools",
      "max_tokens temperature model messages stream tools",
      "max_completion_tokens temperature model messages stream tools",
      "max_completion_tokens model messages stream tools",
    ]);
    // A grammar the server could not build costs the schemas their `pattern`, and nothing else.
    const relaxed = tool("fs__read", "Read a file", { path: { type: "string" } });
    expect(bodies().map((body) => body.tools)).toEqual([[READ], ...Array(5).fill([relaxed])]);
    expect(bodies()[5].max_completion_tokens).toBe(4096);
  });

  /**
   * agent-core latches the refused value and the next body asks for the cheapest effort the model
   * does take. The body used to be built from the setting alone, so the same request went out
   * again and the turn failed on the same refusal.
   */
  it("asks for the cheapest effort the model takes once it has refused the one configured", async () => {
    configure({ reasoningEffort: "minimal" });
    const refusal =
      "Unsupported value: 'reasoning_effort' does not support 'minimal' with this model. " +
      "Supported values are: 'low', 'medium', and 'high'.";
    script = [refuses(refusal), says("hello")];

    const { error, stats } = await run(sessionOf(), "hi");

    expect(error).toBeUndefined();
    expect(stats?.iterations).toBe(1);
    expect(bodies().map((body) => body.reasoning_effort)).toEqual(["minimal", "low"]);
  });
});

describe("a plain answer", () => {
  it("stores the question and the reply, and reports the turn in order", async () => {
    script = [says("Hel", "lo.")];
    const chat = sessionOf({ title: "New chat" });

    // Half a second between the two deltas, and another after the last.
    const { events, stats } = await run(chat, "hi there", {
      onEvent: (event) => {
        if (event.type === "text_delta") {
          vi.advanceTimersByTime(500);
        }
      },
    });

    expect(stats).toEqual({
      promptTokens: 100,
      completionTokens: 10,
      totalTokens: 110,
      model: "m",
      totalMs: 1000,
      iterations: 1,
      toolCalls: 0,
      ttftMs: 0,
      generationMs: 500,
      tokensPerSecond: 20,
      contextTokens: 110,
      lastPromptTokens: 100,
      contextLimit: 32_768,
      breakdown: {
        system: 20,
        guidance: 0,
        catalogue: 0,
        tools: 0,
        summary: 0,
        history: 0,
        historyTools: 0,
        input: 80,
        inputTools: 0,
      },
    });
    expect(events).toEqual([
      { type: "title", title: "hi there" },
      { type: "text_delta", text: "Hel" },
      { type: "text_delta", text: "lo." },
      { type: "stats", stats },
      { type: "done" },
    ]);

    // Written as they are produced: the reply goes in bare, and its stats are patched on after.
    expect(stored).toEqual([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "Hello." },
    ]);
    expect(patches).toEqual([{ row: "row-1", patch: { stats } }]);
    expect(chat.messages).toEqual([
      { role: "user", content: "hi there" },
      { role: "assistant", content: "Hello.", stats },
    ]);
    const usage = { promptTokens: 100, completionTokens: 10, totalTokens: 110 };
    expect(updates).toEqual([{ title: "hi there", model: "m" }, { usage }]);
    expect(chat).toMatchObject({ title: "hi there", model: "m", usage });
  });
});

describe("a tool round trip", () => {
  it("runs the calls together, answers each by id, and stores them in call order", async () => {
    configure({ toolDiscovery: "eager" });
    offer(READ, LS);
    mcp.call.mockImplementation(async (name: string) => {
      if (name === "fs__ls") {
        throw new Error("boom");
      }
      // Slower than the failure beside it, so the two land out of call order.
      await new Promise((resolve) => setTimeout(resolve, 0));
      return "contents of a";
    });
    script = [
      asks(
        ["c1", "fs__read", '{"path":"/a"}'],
        ["c2", "fs__ls", '{"path":"/"}'],
        ["c3", "fs__read", '{"path":'],
        ["c4", "fs__read", '{"path":"/a"}'],
      ),
      says("Done."),
    ];
    const controller = new AbortController();

    const { events, stats } = await run(sessionOf(), "read it", { signal: controller.signal });

    const repeated =
      "contents of a\n\n(Identical call already made this turn; the result is unchanged. " +
      "Use it rather than calling again.)";
    const unparsed = 'model produced invalid tool arguments: {"path":';
    expect(events.slice(0, 6)).toEqual([
      { type: "tool_use", id: "c1", name: "fs__read", input: '{"path":"/a"}' },
      { type: "tool_use", id: "c2", name: "fs__ls", input: '{"path":"/"}' },
      { type: "tool_use", id: "c3", name: "fs__read", input: '{"path":' },
      // Arguments that do not parse are answered before the next call has even been announced.
      { type: "tool_result", toolUseId: "c3", content: unparsed, isError: true },
      { type: "tool_use", id: "c4", name: "fs__read", input: '{"path":"/a"}' },
      // As each lands, not in call order: the failure is back before the read beside it.
      { type: "tool_result", toolUseId: "c2", content: "boom", isError: true },
    ]);
    // The pair that shared a call land together, in whichever order their promises settle.
    expect(events.slice(6, 8)).toEqual(
      expect.arrayContaining([
        { type: "tool_result", toolUseId: "c1", content: "contents of a", isError: false },
        { type: "tool_result", toolUseId: "c4", content: repeated, isError: false },
      ]),
    );
    expect(events.slice(8)).toEqual([
      { type: "text_delta", text: "Done." },
      { type: "stats", stats },
      { type: "done" },
    ]);

    // The identical pair shared one call, and each call was handed the turn's own signal.
    expect(mcp.call.mock.calls).toEqual([
      ["fs__read", { path: "/a" }, controller.signal],
      ["fs__ls", { path: "/" }, controller.signal],
    ]);

    const call = (id: string, name: string, args: string) => ({
      id,
      type: "function",
      function: { name, arguments: args },
    });
    expect(stored).toEqual([
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          call("c1", "fs__read", '{"path":"/a"}'),
          call("c2", "fs__ls", '{"path":"/"}'),
          call("c3", "fs__read", '{"path":'),
          call("c4", "fs__read", '{"path":"/a"}'),
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "contents of a" },
      { role: "tool", tool_call_id: "c2", content: "boom" },
      { role: "tool", tool_call_id: "c3", content: unparsed },
      { role: "tool", tool_call_id: "c4", content: repeated },
      { role: "assistant", content: "Done." },
    ]);
    // The second step is sent the first step's traffic exactly as it was stored.
    expect(bodies()[1].messages).toEqual([
      { role: "system", content: "Be brief." },
      ...stored.slice(0, 6),
    ]);
    expect(stats).toMatchObject({ iterations: 2, toolCalls: 4, promptTokens: 200 });
  });

  it("stops at the iteration cap, keeping what the turn had stored by then", async () => {
    configure({ toolDiscovery: "eager", maxToolIterations: 2 });
    offer(LS);
    mcp.call.mockResolvedValue("a.txt");
    script = [
      asks(["c1", "fs__ls", '{"path":"/"}']),
      asks(["c2", "fs__ls", '{"path":"/tmp"}']),
      says("never asked for"),
    ];

    const { events, error } = await run(sessionOf(), "look around");

    expect(error?.message).toBe("Stopped after 2 tool iterations.");
    expect(requests).toHaveLength(2);
    expect(stored.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
      "tool",
    ]);
    // No stats and no `done`: the turn did not end, it was cut off.
    expect(patches).toEqual([]);
    expect(events.map(({ type }) => type)).toEqual([
      "tool_use",
      "tool_result",
      "tool_use",
      "tool_result",
    ]);
  });
});

describe("loading tools", () => {
  it("grows the tool array in load order on demand, and carries only what was called", async () => {
    offer(READ, LS, NOW);
    mcp.call.mockResolvedValue("12:00");
    script = [
      asks(["c1", "load_tools", '{"names":["fs__read","clock__now"]}']),
      asks(["c2", "clock__now", "{}"]),
      says("Noon."),
    ];
    const chat = sessionOf({ loadedTools: ["fs__ls"] });

    const { events, stats } = await run(chat, "what time is it");

    // Appended, never re-sorted: each step's array is a prefix of the next one's.
    expect(bodies().map(declaredTools)).toEqual([
      ["load_tools", "fs__ls"],
      ["load_tools", "fs__ls", "fs__read", "clock__now"],
      ["load_tools", "fs__ls", "fs__read", "clock__now"],
    ]);
    // The same head on every step: what was loaded is said in the tool array, not the catalogue.
    const heads = bodies().map((body) => messagesOf(body)[0]);
    expect(new Set(heads.map((head) => JSON.stringify(head))).size).toBe(1);

    expect(events.slice(0, 2)).toEqual([
      {
        type: "tool_use",
        id: "c1",
        name: "load_tools",
        input: '{"names":["fs__read","clock__now"]}',
      },
      {
        type: "tool_result",
        toolUseId: "c1",
        content:
          "Loaded 2 tool(s); they are callable on your next step.\n\n" +
          "fs__read: Read a file\nclock__now: The time",
        isError: false,
      },
    ]);
    expect(mcp.call.mock.calls).toEqual([["clock__now", {}, undefined]]);
    // Loading is bookkeeping: it is a round trip, and not a tool the model used.
    expect(stats).toMatchObject({ iterations: 3, toolCalls: 1 });

    // What was carried stays, what was called joins it, and the guess that went unused does not.
    expect(chat.loadedTools).toEqual(["fs__ls", "clock__now"]);
    expect(updates.at(-1)).toEqual({ loadedTools: ["fs__ls", "clock__now"] });
  });

  it("answers a proxied load with the definitions, and runs them through call_tool", async () => {
    configure({ toolDiscovery: "proxy" });
    offer(READ, LS, NOW);
    mcp.call.mockResolvedValue("contents of a");
    const proxied = '{"name":"fs__read","arguments":{"path":"/a"}}';
    script = [
      asks(["c1", "load_tools", '{"names":["fs__read"]}']),
      asks(["c2", "call_tool", proxied]),
      says("Read."),
    ];
    const chat = sessionOf({ loadedTools: ["fs__ls"] });

    const { events, stats } = await run(chat, "read /a");

    // The array never moves, whatever is loaded.
    expect(bodies().map(declaredTools)).toEqual(Array(3).fill(["load_tools", "call_tool"]));
    const definition = JSON.stringify({
      name: "fs__read",
      description: "Read a file",
      parameters: READ.function.parameters,
    });
    expect(events.slice(0, 4)).toEqual([
      { type: "tool_use", id: "c1", name: "load_tools", input: '{"names":["fs__read"]}' },
      {
        type: "tool_result",
        toolUseId: "c1",
        content: `Loaded 1 tool(s). Run them with \`call_tool\`.\n\n${definition}`,
        isError: false,
      },
      // Shown as the tool it ran; stored as the `call_tool` the model wrote.
      { type: "tool_use", id: "c2", name: "fs__read", input: '{"path":"/a"}' },
      { type: "tool_result", toolUseId: "c2", content: "contents of a", isError: false },
    ]);
    expect(stored[3]).toMatchObject({
      tool_calls: [{ id: "c2", function: { name: "call_tool", arguments: proxied } }],
    });
    expect(mcp.call.mock.calls).toEqual([["fs__read", { path: "/a" }, undefined]]);
    expect(stats).toMatchObject({ iterations: 3, toolCalls: 1 });

    // Nothing is carried: the session's list is neither read nor written.
    expect(chat.loadedTools).toEqual(["fs__ls"]);
    expect(updates.some((patch) => "loadedTools" in patch)).toBe(false);
  });
});

describe("hooks", () => {
  it("stores the context beside the question, and sends it on the question", async () => {
    mcp.runHooks.mockImplementation(async (event: string) =>
      event === "beforeTurn" ? [outcome({ inject: true, text: "likes tea" })] : [],
    );
    script = [says("Tea, then.")];

    const { events, stats } = await run(sessionOf(), "what should I drink?");

    // A session's first turn is also its start.
    expect(mcp.runHooks.mock.calls.map(([event]) => event)).toEqual([
      "sessionStart",
      "beforeTurn",
      "afterTurn",
    ]);
    expect(mcp.runHooks.mock.calls[1][1]).toEqual({
      session: { id: "s1" },
      host: "min-agent",
      prompt: "what should I drink?",
      turn: { index: 0 },
    });

    const context = '<context source="Memory">\nlikes tea\n</context>';
    expect(stored[0]).toEqual({
      role: "user",
      content: "what should I drink?",
      hook_context: context,
    });
    const [, question] = messagesOf(bodies()[0]);
    expect(question.role).toBe("user");
    expect(question.content).toContain(context);
    expect(textOf(question).endsWith("\n\nwhat should I drink?")).toBe(true);

    const note = {
      event: "beforeTurn",
      source: "Memory",
      hookId: "recall",
      tokens: expect.any(Number),
      text: "likes tea",
    };
    // Ahead of the first token, and kept with the turn's stats.
    expect(events[0]).toEqual({ type: "hook", hook: note });
    expect(stats?.hooks).toEqual([note]);
  });

  it("waits for afterTurn, and stores its failure with the turn's stats", async () => {
    mcp.runHooks.mockImplementation(async (event: string) =>
      event === "afterTurn"
        ? [outcome({ event: "afterTurn", hookId: "remember", ok: false, error: "timed out" })]
        : [],
    );
    script = [says("Hello.")];
    const earlier: StoredMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "before" },
    ];

    const { events } = await run(sessionOf({ messages: earlier }), "hi");

    // Not a first turn, so no `sessionStart`; the reply and the turn's messages go to afterTurn.
    expect(mcp.runHooks.mock.calls.map(([event]) => event)).toEqual(["beforeTurn", "afterTurn"]);
    expect(mcp.runHooks.mock.calls[1][1]).toEqual({
      session: { id: "s1" },
      host: "min-agent",
      prompt: "hi",
      reply: "Hello.",
      turn: {
        index: 1,
        messages: [
          { speaker: "user", text: "hi", uuid: expect.stringMatching(/^s1:2:/) },
          { speaker: "assistant", text: "Hello.", uuid: expect.stringMatching(/^s1:3:/) },
        ],
      },
    });

    const note = { event: "afterTurn", source: "Memory", hookId: "remember", error: "timed out" };
    // Said after `done`, once it is stored: the stats went out without it and were patched again.
    expect(events.map(({ type }) => type)).toEqual(["text_delta", "stats", "done", "hook"]);
    expect(events.at(-1)).toEqual({ type: "hook", hook: note });
    expect(patches.map(({ row, patch }) => [row, patch.stats?.hooks])).toEqual([
      ["row-3", undefined],
      ["row-3", [note]],
    ]);
  });
});

describe("stopping a turn", () => {
  it("keeps what had streamed when the reader aborts mid-reply", async () => {
    script = [stalls("Half an ans")];
    const controller = new AbortController();

    const { events, error } = await run(sessionOf(), "hi", {
      signal: controller.signal,
      onEvent: (event) => {
        if (event.type === "text_delta") {
          controller.abort();
        }
      },
    });

    expect(error).toBeInstanceOf(Error);
    // Not sent again: a stopped turn is not a lost request.
    expect(requests).toHaveLength(1);
    expect(events).toEqual([{ type: "text_delta", text: "Half an ans" }]);
    expect(stored).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Half an ans" },
    ]);
    expect(patches).toEqual([]);
  });
});

/**
 * What the first pass left out and the loop still decides: the paths #52's swap has to carry that
 * nothing above holds it to. Pinned the same way — what the code does, odd or not.
 */
describe("what the loop decides beyond the common path", () => {
  /**
   * @param id The call's id.
   * @param name The tool it names.
   * @param args Its arguments, as the model wrote them.
   * @returns The call as a stored assistant message carries it.
   */
  const call = (id: string, name: string, args: string) => ({
    id,
    type: "function",
    function: { name, arguments: args },
  });

  /**
   * @param prompt The prompt tokens the closing chunk reports.
   * @param cached How many of them the server says it found cached.
   * @returns The usage chunk, in the server's own spelling.
   */
  const usage = (prompt: number, cached: number) => ({
    choices: [],
    usage: {
      prompt_tokens: prompt,
      completion_tokens: 10,
      total_tokens: prompt + 10,
      prompt_tokens_details: { cached_tokens: cached },
    },
  });

  it("streams reasoning as its own deltas, stores it with the reply, and never sends it back", async () => {
    configure({ toolDiscovery: "eager" });
    offer(LS);
    mcp.call.mockResolvedValue("a.txt");
    script = [
      {
        chunks: [
          chunk({ reasoning_content: "They want " }),
          chunk({ reasoning_content: "a listing." }),
          chunk({ tool_calls: [{ index: 0, ...call("c1", "fs__ls", "{}") }] }),
          chunk({}, "tool_calls"),
          USAGE,
        ],
      },
      says("One file."),
    ];

    const { events } = await run(sessionOf(), "what is here");

    expect(events.slice(0, 3)).toEqual([
      { type: "reasoning_delta", text: "They want " },
      { type: "reasoning_delta", text: "a listing." },
      { type: "tool_use", id: "c1", name: "fs__ls", input: "{}" },
    ]);
    expect(stored[1]).toEqual({
      role: "assistant",
      content: null,
      reasoning_content: "They want a listing.",
      tool_calls: [call("c1", "fs__ls", "{}")],
    });
    const [, , replayed] = messagesOf(bodies()[1]);
    expect(replayed).toEqual({
      role: "assistant",
      content: null,
      tool_calls: [call("c1", "fs__ls", "{}")],
    });
  });

  it("answers the resource tools itself, and declares them ahead of everything else", async () => {
    configure({ toolDiscovery: "eager" });
    offer(READ);
    mcp.resourceServers.mockReturnValue([{ id: "fs", label: "Files" }]);
    mcp.client.mockResolvedValue({
      listResources: async () => ({ resources: [{ uri: "file:///a", name: "a" }] }),
      readResource: async ({ uri }: { uri: string }) => ({ contents: [{ uri, text: "hello" }] }),
    });
    script = [
      asks(
        ["c1", "list_resources", "{}"],
        ["c2", "read_resource", '{"uri":"file:///a"}'],
        ["c3", "read_resource", "{}"],
      ),
      says("Read."),
    ];

    const { events, stats } = await run(sessionOf(), "what do you have");

    expect(declaredTools(bodies()[0])).toEqual(["list_resources", "read_resource", "fs__read"]);
    expect(stored.slice(2, 5)).toEqual([
      { role: "tool", tool_call_id: "c1", content: "Files:\n  file:///a — a" },
      { role: "tool", tool_call_id: "c2", content: "hello" },
      {
        role: "tool",
        tool_call_id: "c3",
        content: "read_resource needs a uri; pass the one list_resources gave.",
      },
    ]);
    const results = events.flatMap((event) =>
      event.type === "tool_result" ? [[event.toolUseId, event.isError]] : [],
    );
    expect(results).toHaveLength(3);
    expect(results).toEqual(
      expect.arrayContaining([
        ["c1", false],
        ["c2", false],
        ["c3", true],
      ]),
    );
    // Not the pool's to run, and counted as tools the model used all the same.
    expect(mcp.call).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ iterations: 2, toolCalls: 3 });
  });

  it("loads a catalogued tool that is called without being loaded, and carries it", async () => {
    offer(READ, LS, NOW);
    mcp.call.mockImplementation(async (name: string) => {
      if (name === "clock__now") {
        return "12:00";
      }
      throw new Error(`no such tool: ${name}`);
    });
    script = [asks(["c1", "clock__now", "{}"], ["c2", "clock__then", "{}"]), says("Noon.")];
    const chat = sessionOf();

    const { events, stats } = await run(chat, "what time is it");

    expect(bodies().map(declaredTools)).toEqual([["load_tools"], ["load_tools", "clock__now"]]);
    // A name nothing offers is called, and fails, and is nothing to declare or carry.
    expect(mcp.call.mock.calls.map(([name]) => name)).toEqual(["clock__now", "clock__then"]);
    expect(events.filter((event) => event.type === "tool_result")).toEqual([
      { type: "tool_result", toolUseId: "c1", content: "12:00", isError: false },
      { type: "tool_result", toolUseId: "c2", content: "no such tool: clock__then", isError: true },
    ]);
    expect(chat.loadedTools).toEqual(["clock__now"]);
    // The last request's split, which counts the definition that call pulled in.
    expect(stats?.breakdown).toEqual({
      system: 1,
      guidance: 0,
      catalogue: 27,
      tools: 47,
      summary: 0,
      history: 0,
      historyTools: 0,
      input: 6,
      inputTools: 19,
    });
  });

  it("answers a repeat load as already loaded, and a load of nothing known as an error", async () => {
    offer(READ, LS, NOW);
    script = [
      asks(
        ["c1", "load_tools", '{"names":["fs__read","fs__ls"]}'],
        ["c2", "load_tools", '{"names":["fs__nope"]}'],
      ),
      says("Loaded."),
    ];
    const chat = sessionOf({ loadedTools: ["fs__read"] });

    const { events, stats } = await run(chat, "get ready");

    expect(events.slice(0, 4)).toEqual([
      { type: "tool_use", id: "c1", name: "load_tools", input: '{"names":["fs__read","fs__ls"]}' },
      {
        type: "tool_result",
        toolUseId: "c1",
        content:
          "Loaded 1 tool(s); they are callable on your next step.\n\n" +
          "fs__ls: List a directory\n\n" +
          "Already loaded and in your tool list: fs__read. Call them directly; " +
          "do not load them again.",
        isError: false,
      },
      { type: "tool_use", id: "c2", name: "load_tools", input: '{"names":["fs__nope"]}' },
      {
        type: "tool_result",
        toolUseId: "c2",
        content: "Not in the catalogue: fs__nope. Check the names and try again.",
        isError: true,
      },
    ]);
    expect(declaredTools(bodies()[1])).toEqual(["load_tools", "fs__read", "fs__ls"]);
    expect(stats).toMatchObject({ iterations: 2, toolCalls: 0 });
    // Nothing was called, so only what was carried in is carried out.
    expect(chat.loadedTools).toEqual(["fs__read"]);
  });

  it("hands a long load result over whole, to the chat and to the transcript", async () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      tool(`fs__tool_${index}`, `${"Describes itself at length. ".repeat(8)}(${index})`),
    );
    offer(...many);
    script = [asks(["c1", "load_tools", '{"names":["fs__tool_*"]}']), says("Loaded.")];

    const { events } = await run(sessionOf(), "get ready");

    const result = events.find((event) => event.type === "tool_result");
    const content = result?.type === "tool_result" ? result.content : "";
    expect(content.length).toBeGreaterThan(2000);
    expect(content.endsWith("(11)")).toBe(true);
    expect(stored[2]).toEqual({ role: "tool", tool_call_id: "c1", content });
  });

  it("answers an identical call from an earlier step of the turn without making it again", async () => {
    configure({ toolDiscovery: "eager" });
    offer(READ);
    mcp.call.mockResolvedValue("contents of a");
    script = [
      asks(["c1", "fs__read", '{"path":"/a"}']),
      asks(["c2", "fs__read", '{"path":"/a"}']),
      says("Done."),
    ];

    await run(sessionOf(), "read it twice");

    expect(mcp.call).toHaveBeenCalledTimes(1);
    expect(stored[2]).toEqual({ role: "tool", tool_call_id: "c1", content: "contents of a" });
    expect(stored[4]).toEqual({
      role: "tool",
      tool_call_id: "c2",
      content:
        "contents of a\n\n(Identical call already made this turn; the result is unchanged. " +
        "Use it rather than calling again.)",
    });
  });

  /**
   * agent-core's `parseToolArguments` would repair these and run the call. Today they are read
   * with `JSON.parse` alone, so the model is told and has to write them again.
   */
  it("refuses arguments that are almost JSON, and stores them as the model wrote them", async () => {
    configure({ toolDiscovery: "eager" });
    offer(READ);
    script = [asks(["c1", "fs__read", "{'path': '/a',}"]), says("Sorry.")];

    const { events } = await run(sessionOf(), "read it");

    expect(mcp.call).not.toHaveBeenCalled();
    expect(events[1]).toEqual({
      type: "tool_result",
      toolUseId: "c1",
      content: "model produced invalid tool arguments: {'path': '/a',}",
      isError: true,
    });
    expect(stored[1]).toMatchObject({ tool_calls: [call("c1", "fs__read", "{'path': '/a',}")] });
  });

  // Arguments are an object by the protocol, and a list or a bare value is as much a mistake
  // as a missing brace: nothing a tool was declared to take. The loop refuses these before a
  // call is dispatched, which is what lets `parseArgs` name what it parsed as a record.
  it.each([
    ["a list", "[1, 2]"],
    ["a string", '"/a"'],
    ["null", "null"],
  ])("refuses arguments that are %s", async (_what, written) => {
    configure({ toolDiscovery: "eager" });
    offer(READ);
    script = [asks(["c1", "fs__read", written]), says("Sorry.")];

    const { events } = await run(sessionOf(), "read it");

    expect(mcp.call).not.toHaveBeenCalled();
    expect(events[1]).toEqual({
      type: "tool_result",
      toolUseId: "c1",
      content: `model produced tool arguments that are not an object: ${written}`,
      isError: true,
    });
  });

  it("runs a call_tool on demand as well, without loading or carrying what it named", async () => {
    offer(READ, LS);
    mcp.call.mockResolvedValue("contents of a");
    const proxied = '{"name":"fs__read","arguments":{"path":"/a"}}';
    script = [asks(["c1", "call_tool", proxied]), says("Read.")];
    const chat = sessionOf();

    const { events } = await run(chat, "read /a");

    expect(events.slice(0, 2)).toEqual([
      { type: "tool_use", id: "c1", name: "fs__read", input: '{"path":"/a"}' },
      { type: "tool_result", toolUseId: "c1", content: "contents of a", isError: false },
    ]);
    expect(mcp.call.mock.calls).toEqual([["fs__read", { path: "/a" }, undefined]]);
    expect(bodies().map(declaredTools)).toEqual([["load_tools"], ["load_tools"]]);
    expect(chat.loadedTools).toEqual([]);
  });

  it("warns when a step finds much less cached than the request before it sent", async () => {
    const warn = vi.mocked(console.warn);
    const earlier: StoredMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "before", stats: turnStats({ lastPromptTokens: 1000 }) },
    ];
    configure({ toolDiscovery: "eager" });
    offer(LS);
    mcp.call.mockResolvedValue("a.txt");
    script = [
      // Held to the turn before: 1000 tokens went out last, and 100 of this one were found.
      {
        chunks: [
          chunk({ tool_calls: [{ index: 0, ...call("c1", "fs__ls", "{}") }] }),
          chunk({}, "tool_calls"),
          usage(1100, 100),
        ],
      },
      // Held to the step before: 1100 went out and 1090 were found, which is no miss.
      { chunks: [chunk({ content: "One file." }), chunk({}, "stop"), usage(1200, 1090)] },
    ];

    await run(sessionOf({ messages: earlier }), "what is here");

    expect(warn.mock.calls.map(([line]) => line)).toEqual([
      "[agent] prompt cache missed: 100 of 1100 cached, after a 1000-token request",
    ]);
  });

  /** B1: the lookup stopped at the newest stats and read no count as a prompt of nothing. */
  it("holds a step to the last turn that counted its prompt, past one that did not", async () => {
    const earlier: StoredMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "before", stats: turnStats({ lastPromptTokens: 1000 }) },
      { role: "user", content: "later" },
      // A turn whose server reported no usage: stats, and no prompt count among them.
      { role: "assistant", content: "uncounted", stats: turnStats() },
    ];
    script = [{ chunks: [chunk({ content: "hello" }), chunk({}, "stop"), usage(1100, 100)] }];

    await run(sessionOf({ messages: earlier }), "hi");

    expect(vi.mocked(console.warn).mock.calls.map(([line]) => line)).toEqual([
      "[agent] prompt cache missed: 100 of 1100 cached, after a 1000-token request",
    ]);
  });

  it("says nothing about the cache where the server reports none", async () => {
    const earlier: StoredMessage[] = [
      { role: "user", content: "earlier" },
      { role: "assistant", content: "before", stats: turnStats({ lastPromptTokens: 1000 }) },
    ];
    script = [says("hello")];

    await run(sessionOf({ messages: earlier }), "hi");

    expect(vi.mocked(console.warn)).not.toHaveBeenCalled();
  });

  it("answers an overflow once, in the server's words and with the window it was built to", async () => {
    script = [refuses("This model's maximum context length is 4096 tokens."), says("never sent")];

    const { events, error } = await run(sessionOf(), "hi");

    expect(error?.name).toBe("ContextOverflow");
    expect(error?.message).toBe(
      "400 This model's maximum context length is 4096 tokens. — this turn was built to 32.8k " +
        "tokens, so the window in Settings → Agent is larger than what the server actually serves.",
    );
    expect(requests).toHaveLength(1);
    expect(events).toEqual([]);
    expect(stored).toEqual([{ role: "user", content: "hi" }]);
  });

  it("stores a stopped tool call's answer before the stop ends the turn", async () => {
    configure({ toolDiscovery: "eager" });
    offer(LS);
    const controller = new AbortController();
    mcp.call.mockImplementation(
      (_name: string, _input: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("stopped by the reader")));
        }),
    );
    script = [asks(["c1", "fs__ls", "{}"]), says("never asked for")];

    const { events, error } = await run(sessionOf(), "look around", {
      signal: controller.signal,
      onEvent: (event) => {
        // Once the call is in flight, not as it is announced.
        if (event.type === "tool_use") {
          setTimeout(() => controller.abort(), 0);
        }
      },
    });

    expect(error).toBeInstanceOf(Error);
    expect(requests).toHaveLength(1);
    expect(events).toEqual([
      { type: "tool_use", id: "c1", name: "fs__ls", input: "{}" },
      { type: "tool_result", toolUseId: "c1", content: "stopped by the reader", isError: true },
    ]);
    // The transcript stays one a server will take: the call the model made has its answer.
    expect(stored).toEqual([
      { role: "user", content: "look around" },
      { role: "assistant", content: null, tool_calls: [call("c1", "fs__ls", "{}")] },
      { role: "tool", tool_call_id: "c1", content: "stopped by the reader" },
    ]);
  });
});
