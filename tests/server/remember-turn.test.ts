import { type CompactionRecord, resetAll, turnIndex, turnMessages } from "@cubicecho/agent-core";
import type { Mcp } from "../../server/mcp.ts";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
} from "../../shared/types.ts";
import { jsonBody, sessionOf, textOf } from "../helpers.ts";
import { connectFixtures, remembered } from "./mcp-fixture.ts";

/**
 * What a memory server is told after a turn, through the real pool and an in-process server
 * whose `afterTurn` hook files the turn.
 *
 * The turn's place in the chat is the stored transcript's: its index there, and a uuid per
 * message at the message's stored position. That is what the next fold's `beforeCompact` names
 * the same messages by, so a turn told under any other numbering is filed twice. The question is
 * told as it was typed, without the recall its hooks put on it, which is a memory the user did not
 * write.
 *
 * The expected values are `turnIndex` and `turnMessages` over the stored transcript, which is
 * how min-agent told `afterTurn` before the loop told it — so each row here holds the loop's
 * numbering to the stored one, across a fold made on the turn, one already in force, and one that
 * kept its question.
 */

const BASE_URL = "http://box:8080/v1";

let settings: LlmConfig;
let mcp: Mcp | undefined;

const store = {
  addMessage: async (_session: string, idx: number) => `row-${idx}`,
  patchMessage: async () => {},
  updateSession: async () => {},
};

const { runTurn } = await import("../../server/agent.ts");

/** One scripted reply of the chat model: what it says, and the calls it makes after saying it. */
interface Reply {
  text?: string;
  calls?: [id: string, name: string][];
}

/** What the chat model answers, in order. A summary request is answered "the notes". */
let script: Reply[] = [];

const chunk = (delta: object, finish: string | null = null) => ({
  id: "chunk",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
});

/**
 * The endpoint: a streamed request is the chat model's, anything else at `/chat/completions` is
 * the summariser, and every other route is a 404.
 *
 * @param url Where the SDK posted.
 * @param init The request.
 * @returns The next scripted reply.
 */
async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(url).endsWith("/chat/completions") === false) {
    return new Response("{}", { status: 404 });
  }
  const body = jsonBody(String(init?.body));
  if (!body.stream) {
    return Response.json({
      id: "summary",
      object: "chat.completion",
      created: 0,
      model: "small",
      choices: [
        { index: 0, message: { role: "assistant", content: "the notes" }, finish_reason: "stop" },
      ],
    });
  }
  const { text, calls = [] } = script.shift() ?? { text: "?" };
  const chunks = [
    ...(text ? [chunk({ content: text })] : []),
    ...(calls.length
      ? [
          chunk({
            tool_calls: calls.map(([id, name], index) => ({
              index,
              id,
              type: "function",
              function: { name, arguments: "{}" },
            })),
          }),
        ]
      : []),
    chunk({}, calls.length ? "tool_calls" : "stop"),
    { choices: [], usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 } },
  ];
  const encoder = new TextEncoder();
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

/** 400 characters, so 100 tokens by the planner's count. */
const long = (tag: string) => `${tag} ${"x".repeat(400 - tag.length - 1)}`;

/** Six long exchanges, the last reporting enough of a 1000-token window used to fold. */
const filling = (): StoredMessage[] => [
  ...["0", "1", "2", "3", "4"].flatMap((n): StoredMessage[] => [
    { role: "user", content: long(`q${n}`) },
    { role: "assistant", content: long(`a${n}`) },
  ]),
  { role: "user", content: long("q5") },
  {
    role: "assistant",
    content: long("a5"),
    stats: {
      model: "m",
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      totalMs: 0,
      iterations: 1,
      toolCalls: 0,
      contextTokens: 750,
    },
  },
];

/** A call and its result, as a tool loop stores them. */
const called = (id: string): StoredMessage[] => [
  {
    role: "assistant",
    content: null,
    tool_calls: [{ id, type: "function", function: { name: "memory__lookup", arguments: "{}" } }],
  },
  { role: "tool", tool_call_id: id, content: "lookup done" },
];

/** A question whose tool loop an earlier fold cut inside of, so the fold kept the question. */
const keptQuestion = (): { messages: StoredMessage[]; compaction: CompactionRecord } => ({
  messages: [
    { role: "user", content: "q0" },
    { role: "assistant", content: "a0" },
    { role: "user", content: "q1" },
    ...called("k1"),
    ...called("k2"),
    { role: "assistant", content: "a1" },
  ],
  compaction: { summary: "notes", through: 5, question: 2, at: "2026-01-01T00:00:00.000Z" },
});

/** A chat, what it starts with, the settings beyond the defaults, and its turns. */
interface Row {
  name: string;
  start: Partial<Session>;
  config: Partial<LlmConfig>;
  turns: { prompt: string; replies: Reply[] }[];
}

/** A turn that looks something up between saying it will and answering. */
const lookingUp = (prompt: string, answer: string, id: string) => ({
  prompt,
  replies: [{ text: "Let me look.", calls: [[id, "memory__lookup"]] }, { text: answer }] as Reply[],
});

const ROWS: Row[] = [
  {
    name: "unfolded",
    start: {},
    config: {},
    turns: [lookingUp("what should I drink?", "Tea.", "c1"), lookingUp("to eat?", "Toast.", "c2")],
  },
  {
    name: "folded on its first turn",
    start: { messages: filling() },
    config: { contextLimit: 1000, taskModels: { compaction: "small" } },
    turns: [
      lookingUp("and now?", "Fine.", "c1"),
      { prompt: "then?", replies: [{ text: "Done." }] },
    ],
  },
  {
    name: "after a fold that kept its question",
    start: keptQuestion(),
    config: {},
    turns: [lookingUp("next?", "Next.", "c1"), { prompt: "last?", replies: [{ text: "Last." }] }],
  },
];

/**
 * What `afterTurn` is told about the turn that just ended, read off the stored transcript.
 *
 * @param chat The chat, the turn's reply last.
 * @param prompt The question as it was typed.
 * @returns The `remember` hook's arguments.
 */
function toldOf(chat: Session, prompt: string) {
  const at = chat.messages.findLastIndex((message) => message.role === "user");
  return {
    session: chat.id,
    index: turnIndex(chat.messages, at),
    prompt,
    reply: textOf(chat.messages[chat.messages.length - 1]),
    turns: turnMessages(chat.id, chat.messages, at),
  };
}

beforeEach(async () => {
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  remembered.length = 0;
  script = [];
  mcp = await connectFixtures("memory");
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await mcp?.shutdown();
  mcp = undefined;
});

describe.each(["", "Be brief."])("with the system prompt %j", (systemPrompt) => {
  it.each(ROWS)(
    "a turn is remembered at its stored index and positions, $name",
    async ({ start, config, turns }) => {
      settings = llmConfigSchema.parse({
        baseUrl: BASE_URL,
        model: "m",
        systemPrompt,
        toolDiscovery: "eager",
        ...config,
      });
      const chat = sessionOf(structuredClone(start));
      const servers = mcp;
      if (!servers) {
        throw new Error("no servers");
      }

      const expected = [];
      for (const { prompt, replies } of turns) {
        script = [...replies];
        await runTurn(
          { session: chat, prompt, onEvent: () => {} },
          { mcp: servers, store, settings: { current: () => settings } },
        );
        // The recall went on the question as it was sent, and is what afterTurn must not file.
        const question = chat.messages.findLast((message) => message.role === "user");
        expect(question?.hook_context).toContain("likes tea");
        expected.push(toldOf(chat, prompt));
      }

      const told = remembered.filter(({ tool }) => tool === "remember").map(({ args }) => args);
      expect(told).toEqual(expected);
      expect(script).toEqual([]);
    },
  );
});

test("a fold files under the uuids the turns were remembered by", async () => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    toolDiscovery: "eager",
    contextLimit: 1000,
    taskModels: { compaction: "small" },
  });
  const servers = mcp;
  if (!servers) {
    throw new Error("no servers");
  }
  const messages = filling();
  // The window is reported full only once the first two turns are remembered.
  const full = messages.pop();
  const chat = sessionOf({ messages: messages.slice(0, 8) });
  const run = async (prompt: string, replies: Reply[]) => {
    script = replies;
    await runTurn(
      { session: chat, prompt, onEvent: () => {} },
      { mcp: servers, store, settings: { current: () => settings } },
    );
  };

  await run(long("q4"), [{ text: long("a4") }]);
  await run(long("q5"), [{ text: long("a5") }]);
  const last = chat.messages[chat.messages.length - 1];
  last.stats = full?.stats;
  await run("and now?", [{ text: "Fine." }]);

  const uuids = (tool: string, key: string) =>
    remembered
      .filter((call) => call.tool === tool)
      .flatMap(({ args }) => args[key] as { uuid: string }[])
      .map(({ uuid }) => uuid);
  const through = chat.compaction?.through ?? 0;
  const filed = uuids("file", "turns");
  // Every message of the remembered turns that the fold took is filed under the same uuid.
  const told = uuids("remember", "turns").filter((uuid) => Number(uuid.split(":")[1]) < through);
  expect(told.length).toBeGreaterThan(0);
  expect(filed).toEqual(expect.arrayContaining(told));
});
