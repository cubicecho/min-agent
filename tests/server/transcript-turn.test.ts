import { resetAll, SUMMARY_LEAD } from "@cubicecho/agent-core";
import type { HookOutcome } from "@cubicecho/agent-mcp-pool";
import type OpenAI from "openai";
import {
  type LlmConfig,
  llmConfigSchema,
  type Session,
  type StoredMessage,
} from "../../shared/types.ts";
import { jsonBody, messagesOf, sessionOf, streamed, textOf } from "../helpers.ts";
import { hookRunnerOver } from "./helpers.ts";

/**
 * The two records a turn keeps of a chat, pinned from outside: the rows the chat shows, appended
 * as the loop writes each message, and the transcript the model was sent, which the next turn
 * continues. Compacting and pruning are agent-core's loop's; what is pinned here is that min-agent
 * hands the loop the right transcript, gives it what it needs to compact, and stores what it
 * hands back.
 *
 * The endpoint is a `fetch` that records each body. The chat model is `m` and answers "Fine.";
 * the summariser is `small`, and answers with notes.
 */

const BASE_URL = "http://box:8080/v1";

let settings: LlmConfig;

const mcp = {
  catalog: vi.fn(),
  tools: vi.fn(),
  readsOnly: vi.fn(),
  resourceServers: vi.fn(),
  call: vi.fn(),
  runHooks: vi.fn(),
  hookRunner: vi.fn(),
  ask: vi.fn(),
  resources: vi.fn(),
  readResource: vi.fn(),
  labelOf: vi.fn((id: string) => id),
};

/** Every `updateSession` patch, in order, and every `patchMessage` one by row. */
let updates: Record<string, unknown>[] = [];
let patches: [string, Record<string, unknown>][] = [];

const store = {
  addMessage: async (_session: string, idx: number) => `row-${idx}`,
  patchMessage: async (id: string, patch: Record<string, unknown>) => {
    patches.push([id, structuredClone(patch)]);
  },
  updateSession: async (_session: string, patch: Record<string, unknown>) => {
    updates.push(structuredClone(patch));
  },
};

const { runTurn } = await import("../../server/agent.ts");

/** Every body posted, parsed. */
let requests: Record<string, unknown>[] = [];
/** What the chat model's requests report as their prompt. */
let promptTokens = 100;

async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (String(url).endsWith("/chat/completions") === false) {
    return new Response("{}", { status: 404 });
  }
  const body = jsonBody(String(init?.body));
  requests.push(body);
  return body.model === "small"
    ? streamed("the notes")
    : streamed("Fine.", {
        prompt_tokens: promptTokens,
        completion_tokens: 10,
        total_tokens: promptTokens + 10,
      });
}

const chatted = () => requests.filter((body) => body.model === "m");
const summarised = () => requests.filter((body) => body.model === "small");
/** What the chat model was sent, the system prompt left off. */
const sent = (body = chatted().at(-1)) => messagesOf(body ?? {}).filter((m) => m.role !== "system");

const configure = (patch: Partial<LlmConfig> = {}) => {
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "m",
    systemPrompt: "Be brief.",
    ...patch,
  });
};

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

/** 400 characters, so 100 tokens by the estimate. */
const long = (tag: string) => `${tag} ${"x".repeat(400 - tag.length - 1)}`;

/** Six exchanges of 100-token messages: far past three quarters of a 1000-token window. */
const longChat = (): StoredMessage[] =>
  Array.from({ length: 6 }, (_, at) => [
    { role: "user" as const, content: long(`q${at}`) },
    { role: "assistant" as const, content: long(`a${at}`) },
  ]).flat();

const run = (chat: Session, prompt = "and now?") =>
  runTurn(
    { session: chat, prompt, onEvent: () => {} },
    { mcp, store, settings: { current: () => settings } },
  );

/** The last transcript a turn stored. */
const storedTranscript = () =>
  updates.flatMap((patch) => ("transcript" in patch ? [patch.transcript] : [])).at(-1) as
    | OpenAI.ChatCompletionMessageParam[]
    | null
    | undefined;

beforeEach(() => {
  resetAll();
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  requests = [];
  updates = [];
  patches = [];
  promptTokens = 100;
  configure();

  for (const mock of Object.values(mcp)) {
    mock.mockReset();
  }
  mcp.hookRunner.mockImplementation(hookRunnerOver(mcp.runHooks));
  mcp.catalog.mockReturnValue([]);
  mcp.tools.mockReturnValue([]);
  mcp.readsOnly.mockReturnValue(false);
  mcp.resourceServers.mockReturnValue([]);
  mcp.runHooks.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the transcript a turn stores", () => {
  it("is what the model was sent and said, beside the rows the chat shows", async () => {
    const chat = sessionOf();
    await run(chat, "hi");

    expect(storedTranscript()).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Fine." },
    ]);
    expect(chat.transcript).toEqual(storedTranscript());
    expect(chat.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "hi"],
      ["assistant", "Fine."],
    ]);
    expect(chat.ledger?.length).toBeGreaterThan(0);
  });

  it("keeps the hooks' context on its question, and stores it beside the question's row", async () => {
    mcp.runHooks.mockImplementation(async (event: string) =>
      event === "beforeExchange" ? [outcome({ inject: true, text: "likes tea" })] : [],
    );
    const chat = sessionOf();
    await run(chat, "what should I drink?");

    const [question] = storedTranscript() ?? [];
    expect(textOf(question)).toContain("likes tea");
    expect(textOf(question).endsWith("what should I drink?")).toBe(true);
    // The question as sent is the question as stored, so the next turn's request begins with it.
    expect(question).toEqual(sent()[0]);
    const [row, patch] = patches.find(([, each]) => "hook_context" in each) ?? [];
    expect(row).toBe("row-0");
    expect(patch?.hook_context).toContain("likes tea");
    expect(chat.messages[0].content).toBe("what should I drink?");
  });

  it("is continued by the next turn rather than rebuilt from the rows", async () => {
    const transcript: OpenAI.ChatCompletionMessageParam[] = [
      { role: "user", content: `${SUMMARY_LEAD}what came before` },
      { role: "assistant", content: "Understood." },
    ];
    const chat = sessionOf({ messages: longChat(), transcript });
    await run(chat);

    expect(sent()).toEqual([...transcript, { role: "user", content: "and now?" }]);
    expect(storedTranscript()).toEqual([
      ...transcript,
      { role: "user", content: "and now?" },
      { role: "assistant", content: "Fine." },
    ]);
  });

  it("is rebuilt from the rows where there is none, their hooks' context put back", async () => {
    const chat = sessionOf({
      messages: [
        { role: "user", content: "hi", hook_context: "<context>tea</context>" },
        { role: "assistant", content: "Hello.", stats: undefined },
      ],
    });
    await run(chat);

    const [question, reply, asked] = sent();
    expect(textOf(question)).toContain("<context>tea</context>");
    expect(reply).toEqual({ role: "assistant", content: "Hello." });
    expect(asked).toEqual({ role: "user", content: "and now?" });
  });
});

describe("a turn that finds the window filling", () => {
  beforeEach(() => configure({ contextLimit: 1000, taskModels: { compaction: "small" } }));

  it("has the loop summarise the head, sends the summary, and stores the compacted transcript", async () => {
    const chat = sessionOf({ messages: longChat() });
    await run(chat);

    expect(summarised()).toHaveLength(1);
    const [opening] = sent();
    expect(textOf(opening).startsWith(SUMMARY_LEAD)).toBe(true);
    expect(textOf(opening)).toContain("the notes");
    expect(sent().length).toBeLessThan(longChat().length);
    // The model's record is compacted; the chat's rows keep every message.
    expect(textOf((storedTranscript() ?? [])[0])).toContain("the notes");
    expect(chat.messages).toHaveLength(longChat().length + 2);
  });

  it("tells beforeCompact before the summary, and keeps the transcript whole on a veto", async () => {
    mcp.runHooks.mockImplementation(async (event: string) =>
      event === "beforeCompact" ? [outcome({ event: "beforeCompact", veto: true })] : [],
    );
    const chat = sessionOf({ messages: longChat() });
    await run(chat);

    expect(mcp.runHooks.mock.calls.map(([event]) => event)).toContain("beforeCompact");
    expect(summarised()).toHaveLength(0);
    expect(sent()).toHaveLength(longChat().length + 1);
  });

  it("compacts nothing without a model to write the summary", async () => {
    configure({ contextLimit: 1000 });
    await run(sessionOf({ messages: longChat() }));

    expect(summarised()).toHaveLength(0);
    expect(sent()).toHaveLength(longChat().length + 1);
  });

  it("tells afterExchange the question's place in the chat, not in what compaction left", async () => {
    const chat = sessionOf({
      messages: longChat(),
      transcript: [
        { role: "user", content: `${SUMMARY_LEAD}what came before` },
        { role: "assistant", content: "Understood." },
      ],
    });
    await run(chat);
    await vi.waitFor(() =>
      expect(mcp.runHooks.mock.calls.some(([event]) => event === "afterExchange")).toBe(true),
    );

    const [, told] = mcp.runHooks.mock.calls.find(([event]) => event === "afterExchange") ?? [];
    expect(told.turn.index).toBe(6);
  });
});
