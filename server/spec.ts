import { AGENT_SPEC, type AgentSpec, type ToolsSpec } from "@cubicecho/agent-core/spec";
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
  for (const { key } of MODEL_TASKS) tasks[key] = { model: taskModels[key]?.trim() ?? "" };
  for (const [key, model] of Object.entries(taskModels)) tasks[key] ??= { model };
  return tasks;
}

/**
 * Builds the agent spec for a settings row.
 * @param config The row. Every field is read by name and the row is never spread, so `apiKey`
 * has no way into the document.
 * @returns A `cubicecho.agent/1` document with no `tools.servers` key, which means every server.
 */
export function settingsSpec(config: LlmConfig): AgentSpec {
  return {
    spec: AGENT_SPEC,
    id: "default",
    name: "min-agent",
    endpoint: { baseUrl: config.baseUrl },
    model: {
      model: config.model,
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      reasoningEffort: config.reasoningEffort,
      // Zero means "ask the server" on both sides, so it crosses as it is.
      contextLength: config.contextLimit,
    },
    prompt: [{ id: PROMPT_PART, text: config.systemPrompt }],
    tools: {
      // The one cast: the format's enum is `eager | ondemand` until cubicecho/agent-core#120
      // adds `proxy`, and a proxy row is exported as what it is rather than as something else.
      discovery: config.toolDiscovery as ToolsSpec["discovery"],
      maxIterations: config.maxToolIterations,
    },
    tasks: tasksOf(config.taskModels),
    extensions: {
      [SPEC_EXTENSION]: {
        pricing: {
          inputPer1M: config.pricing.inputPer1M,
          outputPer1M: config.pricing.outputPer1M,
        },
        voiceBaseUrl: config.voiceBaseUrl,
        sttModel: config.sttModel,
        ttsModel: config.ttsModel,
        ttsVoice: config.ttsVoice,
        speakReplies: config.speakReplies,
      },
    },
  };
}
