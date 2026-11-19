import { progressChunk, RunEventKind, resetAll, stamp } from "@cubicecho/agent-core";
import type { ToolDefinition } from "@cubicecho/agent-mcp-pool";
import { isRemoteAgent, resetRemoteAgents } from "../../server/remote-agent.ts";
import { type LlmConfig, llmConfigSchema, type StreamEvent } from "../../shared/types.ts";
import { declaredTools, jsonBody, sessionOf, streamed } from "../helpers.ts";
import { hookRunnerOver } from "./helpers.ts";

/**
 * A turn on an ai-router agent: a model that runs its own loop and hands the app's tools back.
 *
 * The endpoint lists `helper` as an agent and `plain` as a model, and answers a chat request with
 * "Fine." — after one progress chunk of the agent's own tool call, where the request asked for
 * progress.
 */

const BASE_URL = "http://router:8080/v1";

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

const store = {
  addMessage: async (_session: string, idx: number) => `row-${idx}`,
  patchMessage: async () => {},
  updateSession: async () => {},
};

const { runTurn } = await import("../../server/agent.ts");

/** Every chat body posted, parsed, and how many times the listing was read. */
let requests: Record<string, unknown>[] = [];
let listings = 0;

const LISTING = {
  object: "list",
  data: [
    { id: "helper", object: "model", owned_by: "ai-router", ai_router: { kind: "agent" } },
    { id: "plain", object: "model", owned_by: "ai-router" },
  ],
};

/** The agent's own call, as ai-router's progress tells it. */
const agentsCall = stamp(
  { kind: RunEventKind.ToolCall, id: "srv-1", name: "web__search", text: '{"q":"tea"}' },
  "run-1",
  1,
  0,
);
const agentsResult = stamp(
  { kind: RunEventKind.ToolResult, id: "srv-1", name: "web__search", text: "green", ok: true },
  "run-1",
  2,
  0,
);

/** "Fine.", led by the agent's progress where the request asked for it. */
function reply(body: Record<string, unknown>): Response {
  const answer = streamed("Fine.");
  const asked = (body.ai_router as { progress?: boolean } | undefined)?.progress === true;
  if (!asked || !answer.body) {
    return answer;
  }
  const head = { id: "c", created: 0, model: String(body.model) };
  const encoder = new TextEncoder();
  const progress = [agentsCall, agentsResult].map((event) =>
    encoder.encode(`data: ${JSON.stringify(progressChunk(event, head))}\n\n`),
  );
  const rest = answer.body;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const chunk of progress) {
        controller.enqueue(chunk);
      }
      const reader = rest.getReader();
      for (let read = await reader.read(); !read.done; read = await reader.read()) {
        controller.enqueue(read.value);
      }
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function endpoint(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const path = String(url);
  if (path.endsWith("/models")) {
    listings++;
    return new Response(JSON.stringify(LISTING), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }
  if (path.endsWith("/chat/completions") === false) {
    return new Response("{}", { status: 404 });
  }
  const body = jsonBody(String(init?.body));
  requests.push(body);
  return reply(body);
}

const tool = (name: string): ToolDefinition => ({
  type: "function",
  function: { name, description: name, parameters: { type: "object", properties: {} } },
});

const run = async (model: string) => {
  const events: StreamEvent[] = [];
  await runTurn(
    { session: sessionOf(), prompt: "hi", model, onEvent: (event) => events.push(event) },
    { mcp, store, settings: { current: () => settings } },
  );
  return events;
};

beforeEach(() => {
  resetAll();
  resetRemoteAgents();
  vi.stubGlobal("fetch", endpoint);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  requests = [];
  listings = 0;
  settings = llmConfigSchema.parse({
    baseUrl: BASE_URL,
    model: "plain",
    temperature: 0.4,
    maxTokens: 2048,
    reasoningEffort: "high",
    toolDiscovery: "proxy",
    contextLimit: 1000,
    taskModels: { compaction: "small", toolSelect: "small" },
  });

  for (const mock of Object.values(mcp)) {
    mock.mockReset();
  }
  mcp.hookRunner.mockImplementation(hookRunnerOver(mcp.runHooks));
  mcp.catalog.mockReturnValue([
    { id: "fs", label: "Files", tools: [{ name: "fs__read", description: "Read a file" }] },
  ]);
  mcp.tools.mockReturnValue([tool("fs__read")]);
  mcp.readsOnly.mockReturnValue(true);
  mcp.resourceServers.mockReturnValue([{ id: "fs" }]);
  mcp.runHooks.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isRemoteAgent", () => {
  it("reads the listing's mark, once per model server and model", async () => {
    const server = { baseUrl: BASE_URL, apiKey: "k" };
    expect(await isRemoteAgent(server, "helper")).toBe(true);
    expect(await isRemoteAgent(server, "helper")).toBe(true);
    expect(await isRemoteAgent(server, "plain")).toBe(false);
    expect(await isRemoteAgent(server, "missing")).toBe(false);
    expect(listings).toBe(3);
  });

  it("is no agent where the listing cannot be read, and asks again next time", async () => {
    vi.stubGlobal("fetch", async () => new Response("down", { status: 502 }));
    const server = { baseUrl: BASE_URL, apiKey: "k" };
    expect(await isRemoteAgent(server, "helper")).toBe(false);
    vi.stubGlobal("fetch", endpoint);
    expect(await isRemoteAgent(server, "helper")).toBe(true);
  });
});

describe("a turn on an agent", () => {
  it("sends every tool as the app's own, and none the loop keeps for itself", async () => {
    await run("helper");

    const [body] = requests;
    expect(declaredTools(body).sort()).toEqual(["fs__read", "list_resources", "read_resource"]);
    expect(body.ai_router).toMatchObject({ progress: true });
  });

  it("leaves the sampling, the window and the side tasks to the agent", async () => {
    await run("helper");

    expect(requests.map((body) => body.model)).toEqual(["helper"]);
    const [body] = requests;
    for (const field of [
      "temperature",
      "max_tokens",
      "max_completion_tokens",
      "reasoning_effort",
    ]) {
      expect(body).not.toHaveProperty(field);
    }
  });

  it("cards the agent's own calls from its progress", async () => {
    const events = await run("helper");

    expect(events).toContainEqual(expect.objectContaining({ type: "tool_use", id: "srv-1" }));
    expect(events).toContainEqual({
      type: "tool_result",
      toolUseId: "srv-1",
      content: "green",
      isError: false,
    });
    expect(events.filter((event) => event.type === "tool_use")).toHaveLength(1);
  });

  it("runs a plain model on the same server as it always has", async () => {
    await run("plain");

    const chat = requests.filter((body) => body.model === "plain");
    expect(declaredTools(chat[0])).toContain("load_tools");
    expect(chat[0]).toMatchObject({ temperature: 0.4, max_tokens: 2048 });
  });
});
