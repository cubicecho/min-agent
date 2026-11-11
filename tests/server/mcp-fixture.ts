import type { McpPoolOptions } from "@cubicecho/agent-mcp-pool";
import { memoryTransport } from "@cubicecho/agent-mcp-pool/testing";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  CompleteRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcp } from "../../server/mcp.ts";
import { mcpServerSchema } from "../../shared/types.ts";

/**
 * In-process MCP servers that page everything they list, for the prompt and resource tests to
 * reach through the real pool rather than a stand-in for one.
 *
 * Two items to a page, so every listing of more than two is only whole if the reader followed
 * `nextCursor` — which is the bug these replaced: `resources/list` was read once, and a server that
 * paginates showed a model its first page and nothing to say there was more.
 */

/** One page of `items`, from the offset the cursor names. */
function page<T>(items: T[], cursor: string | undefined, size = 2) {
  const start = cursor ? Number(cursor) : 0;
  const next = start + size;
  return {
    items: items.slice(start, next),
    nextCursor: next < items.length ? String(next) : undefined,
  };
}

const PROMPTS = ["one", "two", "three", "four", "five"].map((name) => ({
  name,
  title: `Prompt ${name}`,
  arguments: [{ name: "topic", required: name === "one" }],
}));
const RESOURCES = [1, 2, 3, 4, 5].map((n) => ({
  uri: `doc://${n}`,
  name: `Doc ${n}`,
  mimeType: "text/plain",
}));
const TEMPLATES = ["a", "b", "c"].map((name) => ({
  uriTemplate: `doc://${name}/{path}`,
  name: `Under ${name}`,
}));
const TOPICS = ["mcp", "models", "memory", "routing"];

/**
 * An SDK server declaring `capabilities` and nothing else: no tools, which is what these servers
 * are for. Since agent-mcp-pool 3.16.1 a server whose handshake does not declare `tools` connects
 * and is listed no tools, where it used to be listed them anyway and fail.
 */
function serverWith(name: string, capabilities: Record<string, object>) {
  return new Server({ name, version: "0.0.1" }, { capabilities });
}

/** A server holding five prompts, five resources and three templates, two to a page. */
function docsServer() {
  const server = serverWith("docs", { prompts: {}, resources: {}, completions: {} });
  server.setRequestHandler(ListPromptsRequestSchema, ({ params }) => {
    const { items, nextCursor } = page(PROMPTS, params?.cursor);
    return { prompts: items, nextCursor };
  });
  server.setRequestHandler(GetPromptRequestSchema, ({ params }) => ({
    messages: [
      {
        role: "user",
        content: { type: "text", text: `${params.name} about ${params.arguments?.topic ?? "?"}` },
      },
    ],
  }));
  server.setRequestHandler(ListResourcesRequestSchema, ({ params }) => {
    const { items, nextCursor } = page(RESOURCES, params?.cursor);
    return { resources: items, nextCursor };
  });
  server.setRequestHandler(ListResourceTemplatesRequestSchema, ({ params }) => {
    const { items, nextCursor } = page(TEMPLATES, params?.cursor);
    return { resourceTemplates: items, nextCursor };
  });
  server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => {
    if (params.uri === "doc://image") {
      return { contents: [{ uri: params.uri, mimeType: "image/png", blob: "aGk=" }] };
    }
    if (params.uri.startsWith("doc://") === false || params.uri === "doc://gone") {
      throw new Error(`${params.uri} is not here`);
    }
    return {
      contents: [{ uri: params.uri, mimeType: "text/plain", text: `text of ${params.uri}` }],
    };
  });
  // The topic narrows by prefix, and by the other arguments where any were sent: `context`
  // reaching the server is what lets one argument's suggestions depend on another's value.
  server.setRequestHandler(CompleteRequestSchema, ({ params }) => {
    const prefix = params.argument.value;
    const narrowed = params.context?.arguments?.only;
    const values = TOPICS.filter(
      (topic) => topic.startsWith(prefix) && (narrowed === undefined || topic === narrowed),
    );
    return { completion: { values } };
  });
  return server;
}

/** A server that declares prompts and resources and fails to list either. */
function brokenServer() {
  const server = serverWith("broken", { prompts: {}, resources: {} });
  server.setRequestHandler(ListPromptsRequestSchema, () => {
    throw new Error("prompts are down");
  });
  server.setRequestHandler(ListResourcesRequestSchema, () => {
    throw new Error("resources are down");
  });
  server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => {
    throw new Error(`${params.uri} is not here`);
  });
  return server;
}

/** A server that holds one uri no listing names, as a `resource_link` would hand one over. */
function linkServer() {
  const server = serverWith("links", { resources: {} });
  server.setRequestHandler(ListResourcesRequestSchema, () => ({ resources: [] }));
  server.setRequestHandler(ReadResourceRequestSchema, ({ params }) => {
    if (params.uri !== "link://1") {
      throw new Error(`${params.uri} is not here`);
    }
    return { contents: [{ uri: params.uri, text: "the linked contents" }] };
  });
  return server;
}

/** A server with tools and nothing else, which no prompt or resource listing should ask. */
function toolsServer() {
  const server = serverWith("tools", { tools: {} });
  server.setRequestHandler(ListToolsRequestSchema, () => ({ tools: [] }));
  return server;
}

/** The question `asks` puts to whoever made the call, and the form it wants filled in. */
export const BRANCH_QUESTION = {
  message: "Which branch should I push to?",
  requestedSchema: {
    type: "object" as const,
    properties: {
      branch: { type: "string" as const, title: "Branch", enum: ["main", "dev"] },
      force: { type: "boolean" as const, title: "Force push" },
    },
    required: ["branch"],
  },
};

/**
 * A server whose one tool asks the person a question mid-call and answers with what it was told,
 * as a server that wants a confirmation before it writes would.
 */
function asksServer() {
  const server = new Server({ name: "asks", version: "0.0.1" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [
      { name: "push", description: "Pushes, asking where.", inputSchema: { type: "object" } },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async () => {
    const answer = await server.elicitInput(BRANCH_QUESTION);
    return { content: [{ type: "text", text: JSON.stringify(answer) }] };
  });
  return server;
}

/** Every call the memory server was made, in order, with the arguments as they reached it. */
export const remembered: { tool: string; args: Record<string, unknown> }[] = [];

/**
 * A memory server as a host's hooks reach it: `recall` before a turn, `remember` after it and
 * `file` ahead of a fold, all three hidden from the model, beside one tool the model may call.
 * What each is called with is kept in `remembered`, which is what a memory server files under.
 */
function memoryServer() {
  const server = serverWith("memory", { tools: {} });
  const names = ["recall", "remember", "file", "lookup"];
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: names.map((name) => ({
      name,
      description: `${name}s.`,
      inputSchema: { type: "object" },
    })),
  }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    remembered.push({ tool: params.name, args: params.arguments ?? {} });
    const text = params.name === "recall" ? "likes tea" : `${params.name} done`;
    return { content: [{ type: "text", text }] };
  });
  return server;
}

/** The row fields beyond the transport that a fixture server is configured with. */
const MEMORY_ROW = {
  hiddenTools: ["recall", "remember", "file"],
  hooks: [
    { id: "recall", on: "beforeTurn", tool: "recall", inject: true, args: { query: "{{prompt}}" } },
    {
      id: "remember",
      on: "afterTurn",
      tool: "remember",
      args: {
        session: "{{session.id}}",
        index: "{{turn.index}}",
        prompt: "{{prompt}}",
        reply: "{{reply}}",
        turns: "{{turn.messages}}",
      },
    },
    { id: "file", on: "beforeCompact", tool: "file", args: { turns: "{{compacting}}" } },
  ],
};

const SERVERS = {
  memory: memoryServer,
  docs: docsServer,
  broken: brokenServer,
  links: linkServer,
  tools: toolsServer,
  asks: asksServer,
};
export type FixtureServer = keyof typeof SERVERS;

/** A min-agent row for one fixture server, labelled so a test can tell label from id. */
const row = (id: FixtureServer) =>
  mcpServerSchema.parse({
    id,
    label: `${id} server`,
    transport: "http",
    url: `memory://${id}`,
    ...(id === "memory" ? MEMORY_ROW : {}),
  });

/**
 * The app's MCP servers, connected to the named fixtures in that order.
 *
 * @param ids - The fixture servers to configure.
 * @returns The connected servers; `shutdown()` them after.
 */
export async function connectFixtures(...ids: FixtureServer[]) {
  return connectFixturesWith({}, ...ids);
}

/**
 * `connectFixtures` with pool options laid over the app's — a call timeout short enough to run
 * out inside a test.
 */
export async function connectFixturesWith(options: McpPoolOptions, ...ids: FixtureServer[]) {
  const mcp = createMcp({ createTransport: memoryTransport(SERVERS), log: {}, ...options });
  await mcp.sync(ids.map(row));
  return mcp;
}
