import { AGENT_SPEC, type AgentSpec } from "@cubicecho/agent-core/spec";
import { defineSpecColumns } from "@cubicecho/agent-core/spec/columns";
import { MODEL_TASKS } from "../shared/model-tasks.ts";
import type { LlmConfig } from "../shared/types.ts";

/**
 * The settings row, written as an agent spec.
 *
 * The spec is `@cubicecho/agent-core`'s interchange format — one JSON document any host on that
 * package can read — and min-agent's agent is its one settings row. This is the way out only:
 * the row stays the storage schema, `coerceLlmConfig` stays the way a row is read, and nothing
 * here is consulted when a turn runs.
 *
 * It lives in `server/` rather than `shared/` because Metro resolves packages from
 * `mobile/node_modules` only, and agent-core is not there. The app gets the document over
 * GraphQL, as JSON it never has to interpret.
 */

/** The key min-agent's own fields travel under: the ones the format has no name for. */
export const SPEC_EXTENSION = "com.cubicecho.min-agent";

/** The one prompt part a settings row has. A row holds a single system prompt, so one id. */
const PROMPT_PART = "identity";

/**
 * Maps `taskModels` onto the spec's `tasks`.
 * @param taskModels The row's record; a missing, empty or blank value is a task that is off.
 * @returns Every task in `MODEL_TASKS` order, `""` for off, then any other stored key as it is.
 */
function tasksOf(taskModels: LlmConfig["taskModels"]): NonNullable<AgentSpec["tasks"]> {
  const tasks: NonNullable<AgentSpec["tasks"]> = {};
  // Off is said out loud rather than left out: absent means "not configured" to a reader, and
  // `""` is how a layer above this one is told the task is off.
  for (const { key } of MODEL_TASKS) {
    tasks[key] = { model: taskModels[key]?.trim() ?? "" };
  }
  for (const [key, model] of Object.entries(taskModels)) {
    tasks[key] ??= { model };
  }
  return tasks;
}

/** Where in the extension each of min-agent's own columns lives. */
const own = (key: string) => ["extensions", SPEC_EXTENSION, key] as const;

/**
 * The settings row's columns, each mapped to its field. A settings row is a host's bottom layer,
 * so no column has an "inherit" marker: every value it holds is said, an empty one included.
 *
 * `taskModels` is one record over many fields, which a column table cannot map, so it is read by
 * hand (`tasksOf`) and named as handled. `apiKey` has no row here and so no way into a document.
 */
const COLUMNS = defineSpecColumns<LlmConfig>(
  {
    baseUrl: { path: "endpoint.baseUrl" },
    model: { path: "model.model" },
    maxTokens: { path: "model.maxTokens" },
    temperature: { path: "model.temperature" },
    reasoningEffort: { path: "model.reasoningEffort" },
    reasoningReplay: { path: "model.reasoningReplay" },
    // Zero means "ask the server" on both sides, so it crosses as it is.
    contextLimit: { path: "model.contextLength" },
    systemPrompt: { path: `prompt.${PROMPT_PART}` },
    toolDiscovery: { path: "tools.discovery" },
    maxToolIterations: { path: "tools.maxIterations" },
    pricing: {
      path: own("pricing"),
      // The two prices by name, so a field the row grows does not leave with it unasked.
      toSpec: ({ inputPer1M, outputPer1M }) => ({ inputPer1M, outputPer1M }),
    },
    voiceBaseUrl: { path: own("voiceBaseUrl") },
    sttModel: { path: own("sttModel") },
    ttsModel: { path: own("ttsModel") },
    ttsVoice: { path: own("ttsVoice") },
    speakReplies: { path: own("speakReplies") },
  },
  { handled: ["tasks"] },
);

/**
 * Builds the agent spec for a settings row.
 * @param config The row. Only the columns `COLUMNS` names are read, so `apiKey` has no way into
 * the document.
 * @returns A `cubicecho.agent/1` document with no `tools.servers` key, which means every server.
 */
export function settingsSpec(config: LlmConfig): AgentSpec {
  return {
    ...COLUMNS.toLayer(config),
    spec: AGENT_SPEC,
    id: "default",
    name: "min-agent",
    tasks: tasksOf(config.taskModels),
  };
}
