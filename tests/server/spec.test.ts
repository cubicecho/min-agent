import {
  type AgentSpec,
  parseSpec,
  type ResolvedAgent,
  resolveAgentSpec,
} from "@cubicecho/agent-core/spec";
import { graphql } from "graphql";
import { afterEach, describe, expect, it, vi } from "vitest";
import { coerceLlmConfig } from "../../server/config.ts";
import { schema } from "../../server/graphql/schema.ts";
import { SPEC_EXTENSION, settingsSpec } from "../../server/spec.ts";
import { SpecDocument } from "../../shared/gql/graphql.ts";
import { type LlmConfig, llmConfigSchema } from "../../shared/types.ts";
import { isRecord } from "../helpers.ts";

/**
 * The settings row on its way out as an agent spec, and what has to be true of the document
 * for another host to be able to read it.
 *
 * There is no import in min-agent yet, so the way back is written here rather than in the
 * server: `settingsOf` is the mapping an import would do, and it exists to show that nothing
 * the export says is unreadable by `coerceLlmConfig` — which is the claim the issue makes.
 */

/** A row with nothing left at its default, so a field that fails to cross shows up as a diff. */
const row = (patch: Partial<LlmConfig> = {}): LlmConfig =>
  llmConfigSchema.parse({
    baseUrl: "http://192.168.1.40:8080/v1",
    model: "qwen3:8b",
    maxTokens: 8192,
    temperature: 0,
    maxToolIterations: 12,
    systemPrompt: "You review code.",
    contextLimit: 32768,
    toolDiscovery: "eager",
    reasoningEffort: "low",
    taskModels: { compaction: "qwen3:1.7b", title: "qwen3:0.6b" },
    pricing: { inputPer1M: 0.25, outputPer1M: 2 },
    voiceBaseUrl: "http://192.168.1.41:8000/v1",
    sttModel: "whisper-1",
    ttsModel: "tcp://192.168.1.41:10200",
    ttsVoice: "alloy",
    speakReplies: true,
    ...patch,
  });

/**
 * @param extension What a document carries under min-agent's own key.
 * @returns The columns it holds, or none where it is not an object.
 */
const ownColumns = (extension: unknown) => (isRecord(extension) ? extension : {});

/**
 * A resolved agent back in the shape of a settings row: what an import would hand
 * `coerceLlmConfig`.
 * @param agent What `resolveAgentSpec` returned.
 * @returns The row's columns by name. A task that is off is left out, which is how the row
 * stores one.
 */
const settingsOf = (agent: ResolvedAgent): Record<string, unknown> => ({
  baseUrl: agent.baseUrl,
  model: agent.model,
  maxTokens: agent.maxTokens,
  temperature: agent.temperature,
  maxToolIterations: agent.maxToolIterations,
  systemPrompt: agent.systemPrompt,
  contextLimit: agent.contextLength,
  toolDiscovery: agent.toolDiscovery,
  reasoningEffort: agent.reasoningEffort,
  taskModels: Object.fromEntries(
    Object.entries(agent.tasks).map(([task, { model }]) => [task, model]),
  ),
  ...ownColumns(agent.extensions[SPEC_EXTENSION]),
});

/**
 * Parses a document the way a host receiving it would, and fails the test if it was refused.
 * @param document What `settingsSpec` produced, or a layer written by hand.
 * @returns The parsed spec and whatever the parser warned about.
 */
const parsed = (document: unknown): { spec: AgentSpec; warnings: string[] } => {
  const result = parseSpec(document);
  expect(result.errors).toEqual([]);
  if (!result.spec) {
    throw new Error("the document was refused");
  }
  return { spec: result.spec, warnings: result.warnings };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("settingsSpec", () => {
  /** The whole document for a fresh install, so a change to what is exported is a visible diff. */
  it("writes the default row as a cubicecho.agent/1 document", () => {
    expect(settingsSpec(llmConfigSchema.parse({}))).toEqual({
      spec: "cubicecho.agent/1",
      id: "default",
      name: "min-agent",
      endpoint: { baseUrl: "http://localhost:11434/v1" },
      model: {
        model: "",
        maxTokens: 4096,
        temperature: 0.7,
        reasoningEffort: "off",
        contextLength: 0,
      },
      prompt: [{ id: "identity", text: "You are min-agent, a concise and careful assistant." }],
      tools: { discovery: "ondemand", maxIterations: 20 },
      tasks: {
        compaction: { model: "" },
        toolSelect: { model: "" },
        followups: { model: "" },
        title: { model: "" },
      },
      extensions: {
        "com.cubicecho.min-agent": {
          pricing: { inputPer1M: 0, outputPer1M: 0 },
          voiceBaseUrl: "",
          sttModel: "",
          ttsModel: "",
          ttsVoice: "",
          speakReplies: false,
        },
      },
    });
  });

  /**
   * The format has no credential field at any depth, and the mapper reads the row by name
   * rather than spreading it. This is the test that a spread never creeps in: the key is
   * looked for as a string, anywhere in the document, under any name.
   */
  it("never carries the API key", () => {
    const json = JSON.stringify(settingsSpec(row({ apiKey: "sk-not-for-export-4f9a" })));

    expect(json).not.toContain("sk-not-for-export-4f9a");
    expect(json).not.toMatch(/api_?key/i);
  });

  /**
   * min-agent has no server scoping, and the way to say so is to say nothing. `[]` would be
   * read by another host as an agent with no tools at all.
   */
  it("has no servers key, which means every server", () => {
    expect(settingsSpec(row()).tools).toEqual({ discovery: "eager", maxIterations: 12 });
    expect(JSON.stringify(settingsSpec(row()))).not.toContain("servers");
  });

  it("writes the context limit as contextLength, with zero still asking the server", () => {
    expect(settingsSpec(row({ contextLimit: 0 })).model?.contextLength).toBe(0);
    expect(settingsSpec(row({ contextLimit: 32768 })).model?.contextLength).toBe(32768);
  });

  /**
   * A task with no model is exported as `""` rather than left out: absent means nobody
   * configured it, and off is a thing a row says. A key this build has no task for is the
   * row's own and is carried as it is.
   */
  it("writes every task, off ones as an empty model", () => {
    const spec = settingsSpec(
      row({ taskModels: { title: "small", followups: "  ", future: "x" } }),
    );

    expect(spec.tasks).toEqual({
      compaction: { model: "" },
      toolSelect: { model: "" },
      followups: { model: "" },
      title: { model: "small" },
      future: { model: "x" },
    });
  });
});

describe("a settings row, out to a spec and back", () => {
  /**
   * The issue's "done when". The untidy prompt is deliberate: `resolveAgentSpec` trims each
   * prompt part before joining them, so the surrounding whitespace is the one thing in a row
   * that does not come back, and the expectation says so rather than avoiding it.
   */
  it.each(["eager", "ondemand", "proxy"] as const)(
    "round-trips a %s row without a warning",
    (toolDiscovery) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const stored = row({
        toolDiscovery,
        apiKey: "sk-stays-home",
        systemPrompt: "  You review code.\n",
      });

      const { spec, warnings } = parsed(JSON.parse(JSON.stringify(settingsSpec(stored))));
      expect(warnings).toEqual([]);

      const back = coerceLlmConfig(settingsOf(resolveAgentSpec([spec])));

      expect(warn).not.toHaveBeenCalled();
      // The key does not travel, so the row that comes back has none.
      expect(back).toEqual({ ...stored, apiKey: "", systemPrompt: "You review code." });
    },
  );

  /**
   * `extraBody` is the thing min-agent has nowhere to store. The row is not given a column
   * for it here; what is shown is that a layer over the exported document can carry one,
   * that it arrives whole, and that it does not get in the way of reading the rest back.
   */
  it("keeps a layer's extraBody intact, and still reads back as a row", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const extraBody = { top_k: 20, min_p: 0.05, id_slot: 3, stop: ["</s>"] };
    const stored = row();

    const base = parsed(settingsSpec(stored));
    const layer = parsed({ spec: "cubicecho.agent/1", model: { extraBody } });
    expect([...base.warnings, ...layer.warnings]).toEqual([]);

    const resolved = resolveAgentSpec([base.spec, layer.spec]);
    expect(resolved.extraBody).toEqual(extraBody);

    expect(coerceLlmConfig(settingsOf(resolved))).toEqual({ ...stored, apiKey: "" });
    expect(warn).not.toHaveBeenCalled();
  });
});

/**
 * The query, run against the real schema with no database behind it: the resolver reads the
 * settings held in memory, which are the schema's defaults until a row has been loaded.
 */
describe("the spec query", () => {
  it("answers the client's own document with the saved row as a spec", async () => {
    const result = await graphql({ schema, source: SpecDocument.toString() });

    expect(result.errors).toBeUndefined();
    expect(result.data?.spec).toEqual(settingsSpec(llmConfigSchema.parse({})));
    expect(parsed(result.data?.spec).warnings).toEqual([]);
  });
});
