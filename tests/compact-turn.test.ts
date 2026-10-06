import { resetAll } from "@cubicecho/agent-core";
import type { HookOutcome } from "@cubicecho/agent-mcp-pool";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
} from "../shared/types.ts";

/**
 * Compaction as a turn does it, pinned from outside: when the summary is asked for, what the
 * summariser and the `beforeCompact` hooks are handed, what is stored, and what the chat model is
 * sent afterwards.
 *
 * Characterization, written against min-agent's own planner before it was replaced by
 * agent-core's (#50), so a value here is what the code did then and has to keep doing. The
 * harness is `run-turn.test.ts`'s, cut down: the endpoint is a `fetch` that records each body and
 * answers from a script, and the pool, the store and the settings are mocked.
 */

const BASE_URL = "http://box:8080/v1";

/** The summariser's instruction, word for word: a change to it is a change to every summary. */
const SUMMARY_PROMPT =
  "You maintain the running memory of a long conversation. Rewrite the exchange below as " +
  "notes the assistant can rely on after the original messages are gone. Keep decisions, " +
  "facts, file paths, names, numbers, and anything still unresolved. Drop pleasantries and " +
  "anything already superseded. Write compact prose or bullets — no preamble, no sign-off.";

/** How the message that stands in for the folded head opens. */
const SUMMARY_LEAD =
  "Summary of the earlier part of this conversation, which is no longer shown in full:\n\n";

let settings: LlmConfig;

const mcp = {
  catalog: vi.fn(),
  tools: vi.fn(),
  instructions: vi.fn(),
  resourceServers: vi.fn(),
  call: vi.fn(),
  runHooks: vi.fn(),
};

/** Every `updateSession` patch, in order. */
let updates: Record<string, unknown>[] = [];

vi.mock("../server/mcp.ts", () => mcp);
vi.mock("../server/store.ts", () => ({
  addMessage: async (_session: string, idx: number) => `row-${idx}`,
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

/** What the summariser will answer, in order: its text, or a refusal with the endpoint's reason. */
let summaries: (string | { refusal: string })[] = [];
/** Every body posted, parsed. */
let requests: Record<string, unknown>[] = [];

const chunk = (delta: object, finish: string | null = null) => ({
  id: "chunk",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/**
 * The endpoint. A streamed request is the chat model's and is answered "Fine."; anything else is
 * a side task, which here is only ever the summariser.
 *
 * @param url Where the SDK posted.
 * @param init The request, whose body is the JSON exactly as it went out.
 * @returns The reply.
 */
async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const isOtherRequest = String(url).endsWith("/chat/completions") === false;
  if (isOtherRequest) {
    return new Response("{}", { status: 404 });
  }
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
  requests.push(body);

  if (!body.stream) {
    const summary = summaries.shift() ?? "";
    if (typeof summary !== "string") {
      return new Response(JSON.stringify({ error: { message: summary.refusal } }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "summary",
        object: "chat.completion",
        created: 0,
        model: body.model,
        choices: [
          { index: 0, message: { role: "assistant", content: summary }, finish_reason: "stop" },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  const encoder = new TextEncoder();
  const chunks = [
    chunk({ content: "Fine." }),
    chunk({}, "stop"),
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
  ];
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const each of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(each)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** The summariser's requests, and the chat model's. */
const asked = () => requests.filter((body) => !body.stream);
const chatted = () => requests.filter((body) => body.stream);

type Sent = { role: string; content: unknown };

/** A window of 1000 tokens, so a kept tail of 350, and a model configured to write summaries. */
const configure = (patch: Partial<LlmConfig> = {}) => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    systemPrompt: "Be brief.",
    contextLimit: 1000,
    taskModels: { compaction: "small" },
    ...patch,
  });
};

/** 400 characters, so 100 tokens by the planner's count, and recognisable in a summary request. */
const long = (tag: string) => `${tag} ${"x".repeat(400 - tag.length - 1)}`;

/**
 * Six exchanges of 100-token messages, the second answered through a tool, with the fields
 * min-agent keeps for itself on some of them.
 *
 * @param contextTokens What the last turn reported using, which is what decides a fold.
 * @returns Fourteen messages. Walking back from the end, three fit a 350-token tail, and the
 * first user message at or after that point is index 12.
 */
const transcript = (contextTokens: number): StoredMessage[] =>
  [
    { role: "user", content: long("q0"), hook_context: "<context>tea</context>" },
    { role: "assistant", content: long("a0"), reasoning_content: "pondering ".repeat(200) },
    { role: "user", content: long("q1") },
    {
      role: "assistant",
      content: null,
      tool_calls: [
        { id: "call-1", type: "function", function: { name: "fs__ls", arguments: '{"path":"/"}' } },
      ],
    },
    { role: "tool", tool_call_id: "call-1", content: long("listing") },
    { role: "assistant", content: long("a1") },
    { role: "user", content: long("q2") },
    { role: "assistant", content: long("a2") },
    { role: "user", content: long("q3") },
    { role: "assistant", content: long("a3") },
    { role: "user", content: long("q4") },
    { role: "assistant", content: long("a4") },
    { role: "user", content: long("q5") },
    {
      role: "assistant",
      content: long("a5"),
      reasoning_content: "thinking",
      followups: ["Why?"],
      stats: { model: "m", contextTokens, lastPromptTokens: 700 },
    },
  ] as StoredMessage[];

const session = (patch: Partial<Session> = {}): Session => ({
  id: "s1",
  title: "A chat",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  messages: [],
  ...patch,
});

const run = (chat: Session, prompt = "and now?") =>
  runTurn({ session: chat, prompt, onEvent: () => {} });

/** What `beforeCompact` was told, once per time it ran. */
const compactHooks = () =>
  mcp.runHooks.mock.calls.filter(([event]) => event === "beforeCompact").map(([, told]) => told);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  summaries = [];
  requests = [];
  updates = [];
  configure();

  for (const mock of Object.values(mcp)) {
    mock.mockReset();
  }
  mcp.catalog.mockReturnValue([]);
  mcp.tools.mockReturnValue([]);
  mcp.instructions.mockReturnValue([]);
  mcp.resourceServers.mockReturnValue([]);
  mcp.runHooks.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a turn that finds the window filling", () => {
  it("folds the head into a summary, stores it, and sends the summary in its place", async () => {
    summaries = ["  the notes  "];
    const chat = session({ messages: transcript(750) });

    const stats = await run(chat);

    // One summary, asked of the task's model, ahead of the chat model's request.
    expect(requests.map((body) => body.model)).toEqual(["small", "m"]);
    const [summary] = asked();
    expect(summary.max_tokens).toBe(1024);
    expect(summary.temperature).toBe(0.3);
    // Roles and text only, the tool call as `name(arguments)`, none of min-agent's own fields.
    expect(summary.messages).toEqual([
      { role: "system", content: SUMMARY_PROMPT },
      {
        role: "user",
        content: [
          `user: ${long("q0")}`,
          `assistant: ${long("a0")}`,
          `user: ${long("q1")}`,
          'assistant: fs__ls({"path":"/"})',
          `tool: ${long("listing")}`,
          `assistant: ${long("a1")}`,
          `user: ${long("q2")}`,
          `assistant: ${long("a2")}`,
          `user: ${long("q3")}`,
          `assistant: ${long("a3")}`,
          `user: ${long("q4")}`,
          `assistant: ${long("a4")}`,
        ].join("\n\n"),
      },
    ]);

    // The record, trimmed, with the stored index the request is rebuilt from.
    const record = { summary: "the notes", through: 12, at: "2026-01-01T00:00:00.000Z" };
    expect(chat.compaction).toEqual(record);
    expect(updates[0]).toEqual({ compaction: record });
    // Append-only: nothing folded is dropped from the transcript.
    expect(chat.messages).toHaveLength(16);
    expect(chat.messages[0].content).toBe(long("q0"));

    // The chat model gets the summary where the head was, then the kept tail, then the question.
    const [chatRequest] = chatted();
    expect(chatRequest.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "system", content: `${SUMMARY_LEAD}the notes` },
      { role: "user", content: long("q5") },
      { role: "assistant", content: long("a5") },
      { role: "user", content: "and now?" },
    ]);

    // And the readout counts the summary as its own part, not as history.
    expect(stats.breakdown).toEqual({
      system: 1,
      guidance: 0,
      catalogue: 0,
      tools: 0,
      summary: 12,
      history: 84,
      historyTools: 0,
      input: 3,
      inputTools: 0,
    });
  });

  it("tells beforeCompact what is being folded, by its stored indexes", async () => {
    summaries = ["the notes"];

    await run(session({ messages: transcript(750) }));

    // What the user and the assistant said: the call with no words and its result are left out.
    const said = [0, 1, 2, 5, 6, 7, 8, 9, 10, 11];
    expect(compactHooks()).toEqual([
      {
        session: { id: "s1" },
        host: "min-agent",
        compacting: said.map((at) => ({
          speaker: at % 2 === 0 ? "user" : "assistant",
          text: long(["q0", "a0", "q1", "", "", "a1", "q2", "a2", "q3", "a3", "q4", "a4"][at]),
          uuid: expect.stringMatching(new RegExp(`^s1:${at}:[0-9a-f]{12}$`)),
        })),
        range: { from: 0, through: 12 },
      },
    ]);
    // Told beside the summary, not through the chat's signal.
    const call = mcp.runHooks.mock.calls.find(([event]) => event === "beforeCompact");
    expect(call?.[2]?.signal).toBeUndefined();
  });

  it("continues an earlier fold's notes, and starts where that fold ended", async () => {
    summaries = ["newer notes"];
    const earlier = { summary: "older notes", through: 6, at: "2025-12-31T00:00:00.000Z" };
    const chat = session({ messages: transcript(750), compaction: earlier });

    await run(chat);

    const [, input] = asked()[0].messages as Sent[];
    expect(input.content).toBe(
      `Notes so far:\nolder notes\n\nContinue them with this exchange:\n\n${[
        `user: ${long("q2")}`,
        `assistant: ${long("a2")}`,
        `user: ${long("q3")}`,
        `assistant: ${long("a3")}`,
        `user: ${long("q4")}`,
        `assistant: ${long("a4")}`,
      ].join("\n\n")}`,
    );
    expect(compactHooks()[0]).toMatchObject({ range: { from: 6, through: 12 } });
    expect(chat.compaction).toEqual({
      summary: "newer notes",
      through: 12,
      at: "2026-01-01T00:00:00.000Z",
    });
    expect((chatted()[0].messages as Sent[])[1]).toEqual({
      role: "system",
      content: `${SUMMARY_LEAD}newer notes`,
    });
  });

  it("goes on folding when a beforeCompact hook answers with a veto", async () => {
    // As it is today: the hooks are told beside the summary and cannot stop it.
    summaries = ["the notes"];
    mcp.runHooks.mockImplementation(async (event: string) =>
      event === "beforeCompact"
        ? [
            {
              serverId: "mem",
              label: "Memory",
              hookId: "keep",
              event: "beforeCompact",
              ok: true,
              ms: 1,
              inject: false,
              maxTokens: 1000,
              veto: true,
            } as HookOutcome,
          ]
        : [],
    );
    const chat = session({ messages: transcript(750) });

    await run(chat);

    expect(asked()).toHaveLength(1);
    expect(chat.compaction).toMatchObject({ summary: "the notes", through: 12 });
  });
});

describe("a turn that leaves the transcript whole", () => {
  /** The chat model's request when nothing was folded: every stored message, and the question. */
  const whole = (chat: Session) => {
    expect(chat.compaction).toBeUndefined();
    expect(updates.some((patch) => "compaction" in patch)).toBe(false);
    const messages = chatted()[0].messages as Sent[];
    expect(messages).toHaveLength(1 + 14 + 1);
    expect(messages[1].content).toContain("<context>tea</context>");
    expect(messages[1].content).toContain(long("q0"));
  };

  it("does not fold below three quarters of the window", async () => {
    const chat = session({ messages: transcript(749) });

    await run(chat);

    expect(asked()).toHaveLength(0);
    expect(compactHooks()).toHaveLength(0);
    whole(chat);
  });

  it("does not fold when the last turn reported no usage", async () => {
    const chat = session({ messages: transcript(0) });

    await run(chat);

    expect(asked()).toHaveLength(0);
    whole(chat);
  });

  it("does not fold without a model configured for it", async () => {
    configure({ taskModels: {} });
    const unconfigured = session({ messages: transcript(990) });
    await run(unconfigured);
    expect(asked()).toHaveLength(0);
    whole(unconfigured);
  });

  it("does not fold when the only legal cut takes fewer than two messages", async () => {
    // A fold already through 11 leaves one message ahead of the cut at 12.
    const earlier = { summary: "older notes", through: 11, at: "2025-12-31T00:00:00.000Z" };
    const chat = session({ messages: transcript(750), compaction: earlier });

    await run(chat);

    expect(asked()).toHaveLength(0);
    expect(compactHooks()).toHaveLength(0);
    expect(chat.compaction).toEqual(earlier);
  });

  it("stores nothing when the summary comes back empty, though the hooks were told", async () => {
    summaries = ["   "];
    const chat = session({ messages: transcript(750) });

    await run(chat);

    expect(asked()).toHaveLength(1);
    expect(compactHooks()).toHaveLength(1);
    whole(chat);
  });

  it("goes ahead on the whole transcript when the summariser fails", async () => {
    summaries = [{ refusal: "no" }, { refusal: "no" }, { refusal: "no" }];
    const chat = session({ messages: transcript(750) });

    const stats = await run(chat);

    expect(stats.iterations).toBe(1);
    whole(chat);
  });
});
