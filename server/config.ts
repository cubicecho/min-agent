import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import {
  type LlmConfig,
  llmConfigSchema,
  type McpServerConfig,
  mcpFileSchema,
} from "../shared/types.ts";
import { CONFIG_DIR } from "./paths.ts";

const LLM_FILE = path.join(CONFIG_DIR, "llm.yaml");
const MCP_FILE = path.join(CONFIG_DIR, "mcp.yaml");

const SEED_LLM = `# Connection to any OpenAI-compatible server.
# Ollama: http://localhost:11434/v1   LM Studio: http://localhost:1234/v1
# OpenAI: https://api.openai.com/v1   OpenRouter: https://openrouter.ai/api/v1
baseUrl: http://localhost:11434/v1
# Leave empty to fall back to $OPENAI_API_KEY.
apiKey: ""
# Chosen from the models the server reports. Set it in the Config tab.
model: ""
maxTokens: 4096
temperature: 0.7
maxToolIterations: 20
# Context window used for the "used / total" meter. 0 asks the server, which not
# every OpenAI-compatible server answers — set it by hand if the meter stays hidden.
contextLimit: 0
# eager    — send every MCP tool definition on every request (simple, costly)
# ondemand — send a name-only catalogue and let the model load the schemas it needs
toolDiscovery: ondemand
# Side jobs that need not run on the chat model — set a small fast one instead.
# title      — names a new chat from its opening message. Empty truncates the first line.
# compaction — folds the oldest messages into a summary once a session fills 75% of
#              the context window. Empty lets long sessions eventually overflow.
# toolSelect — picks the tools a request needs before the turn starts, so on-demand
#              loading costs no round trip. Only used when toolDiscovery is ondemand.
# followups  — proposes the next few questions under a reply, as clickable chips.
taskModels:
  title: ""
  compaction: ""
  toolSelect: ""
  followups: ""
systemPrompt: |
  You are min-agent, a concise and careful assistant.
  You have access to tools from the user's connected MCP servers.
  Prefer doing the work over describing it. Say plainly when something failed.
# Only used for the cost readout next to the token count. Leave at 0 for local
# models and min-agent shows tokens alone.
pricing:
  inputPer1M: 0
  outputPer1M: 0
`;

const SEED_MCP = `# MCP servers exposed to the agent as tools.
# Tools are namespaced as <server id>__<tool name>.
servers: []
# servers:
#   - id: filesystem
#     label: Filesystem
#     enabled: true
#     transport: stdio
#     command: npx
#     args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
#     env: {}
#   - id: docs
#     label: Docs (HTTP)
#     enabled: false
#     transport: http
#     url: https://example.com/mcp
#     headers: {}
`;

function readOrSeed<T extends z.ZodType>(file: string, seed: string, schema: T): z.infer<T> {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  if (!fs.existsSync(file)) fs.writeFileSync(file, seed, "utf8");
  const raw = YAML.parse(fs.readFileSync(file, "utf8")) ?? {};
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`${path.basename(file)} is invalid:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

/** Note: rewriting a config file drops the comments that shipped with it. */
function write(file: string, value: unknown) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(file, YAML.stringify(value, { lineWidth: 0 }), "utf8");
}

export const loadLlmConfig = (): LlmConfig => readOrSeed(LLM_FILE, SEED_LLM, llmConfigSchema);
export const saveLlmConfig = (config: LlmConfig) => write(LLM_FILE, config);

export const loadMcpServers = (): McpServerConfig[] =>
  readOrSeed(MCP_FILE, SEED_MCP, mcpFileSchema).servers;
export const saveMcpServers = (servers: McpServerConfig[]) => write(MCP_FILE, { servers });

/** The key from llm.yaml, else the environment. */
export const resolveApiKey = (config = loadLlmConfig()) =>
  config.apiKey || process.env.OPENAI_API_KEY || "";
