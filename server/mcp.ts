import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type OpenAI from "openai";
import type { McpServerConfig, McpServerState, McpStatus } from "../shared/types.ts";

const SEPARATOR = "__";

/** One server's tools, without their JSON schemas — the cheap half of a tool definition. */
export interface CatalogServer {
  id: string;
  label: string;
  tools: { name: string; description: string }[];
}

interface Entry {
  config: McpServerConfig;
  client?: Client;
  status: McpStatus;
  error?: string;
  tools: { name: string; description: string; inputSchema: Record<string, unknown> }[];
}

/**
 * Owns one MCP client per configured server and exposes their tools to the
 * agent loop under `<server id>__<tool name>`.
 */
class McpManager {
  private entries = new Map<string, Entry>();

  /** Reconcile live clients with the config file. Called on boot and on every edit. */
  async sync(configs: McpServerConfig[]) {
    for (const [id, entry] of this.entries) {
      if (!configs.some((c) => c.id === id)) {
        await this.close(entry);
        this.entries.delete(id);
      }
    }
    await Promise.all(
      configs.map(async (config) => {
        const existing = this.entries.get(config.id);
        if (existing && JSON.stringify(existing.config) === JSON.stringify(config)) return;
        if (existing) await this.close(existing);
        await this.connect(config);
      }),
    );
  }

  async reconnect(id: string, configs: McpServerConfig[]) {
    const config = configs.find((c) => c.id === id);
    if (!config) return;
    const existing = this.entries.get(id);
    if (existing) await this.close(existing);
    await this.connect(config);
  }

  private async connect(config: McpServerConfig) {
    const entry: Entry = { config, status: config.enabled ? "connecting" : "disabled", tools: [] };
    this.entries.set(config.id, entry);
    if (!config.enabled) return;

    try {
      const client = new Client({ name: "min-agent", version: "0.1.0" });
      const transport =
        config.transport === "stdio"
          ? new StdioClientTransport({
              command: config.command,
              args: config.args,
              env: { ...(process.env as Record<string, string>), ...config.env },
            })
          : new StreamableHTTPClientTransport(new URL(config.url), {
              requestInit: { headers: config.headers },
            });

      await client.connect(transport);
      const { tools } = await client.listTools();

      entry.client = client;
      entry.status = "ready";
      entry.tools = tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        inputSchema: (t.inputSchema ?? { type: "object" }) as Record<string, unknown>,
      }));
      console.log(`[mcp] ${config.id}: ${entry.tools.length} tool(s)`);
    } catch (error) {
      entry.status = "error";
      entry.error = error instanceof Error ? error.message : String(error);
      console.error(`[mcp] ${config.id}: ${entry.error}`);
    }
  }

  private async close(entry: Entry) {
    try {
      await entry.client?.close();
    } catch {
      // a server that died on its own is already closed
    }
    entry.client = undefined;
  }

  /** Every ready tool, in OpenAI function-tool shape. */
  /** The one place a tool's wire name is built, so the catalog and the loop agree. */
  private static qualify(serverId: string, tool: string) {
    return `${serverId}${SEPARATOR}${tool}`.slice(0, 64);
  }

  /**
   * Tool definitions for the model. Pass `names` to get only those — on-demand loading
   * sends a handful of schemas instead of every one.
   */
  tools(names?: string[]): OpenAI.ChatCompletionTool[] {
    const wanted = names && new Set(names);
    const tools: OpenAI.ChatCompletionTool[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready") continue;
      for (const tool of entry.tools) {
        const name = McpManager.qualify(entry.config.id, tool.name);
        if (wanted && !wanted.has(name)) continue;
        tools.push({
          type: "function",
          function: {
            name,
            description: `[${entry.config.label || entry.config.id}] ${tool.description}`.trim(),
            parameters: tool.inputSchema,
          },
        });
      }
    }
    return tools;
  }

  /** Names and descriptions only — what the model browses before loading anything. */
  catalog(): CatalogServer[] {
    const catalog: CatalogServer[] = [];
    for (const entry of this.entries.values()) {
      if (entry.status !== "ready" || !entry.tools.length) continue;
      catalog.push({
        id: entry.config.id,
        label: entry.config.label || entry.config.id,
        tools: entry.tools.map((tool) => ({
          name: McpManager.qualify(entry.config.id, tool.name),
          description: tool.description,
        })),
      });
    }
    return catalog;
  }

  /** Runs one tool call and returns text for a tool_result block. */
  async call(qualifiedName: string, input: unknown): Promise<string> {
    const [serverId, ...rest] = qualifiedName.split(SEPARATOR);
    const entry = serverId ? this.entries.get(serverId) : undefined;
    if (!entry?.client) throw new Error(`MCP server "${serverId}" is not connected`);

    const result = await entry.client.callTool({
      name: rest.join(SEPARATOR),
      arguments: (input ?? {}) as Record<string, unknown>,
    });

    const content = Array.isArray(result.content) ? result.content : [];
    const text = content
      .map((block: { type?: string; text?: string }) =>
        block.type === "text" ? block.text : `[${block.type ?? "unknown"} content]`,
      )
      .join("\n")
      .trim();

    if (result.isError) throw new Error(text || "tool call failed");
    return text || "(no output)";
  }

  state(): McpServerState[] {
    return [...this.entries.values()].map((entry) => ({
      config: entry.config,
      status: entry.status,
      error: entry.error,
      tools: entry.tools.map(({ name, description }) => ({ name, description })),
    }));
  }
}

export const mcp = new McpManager();
