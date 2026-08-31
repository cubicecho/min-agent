import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { llmConfigSchema, modelForTask } from "../shared/types.ts";

let dir: string;
let config: typeof import("../server/config.ts");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "min-agent-config-"));
  process.env.MIN_AGENT_CONFIG_DIR = dir;
  vi.resetModules();
  config = await import("../server/config.ts");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MIN_AGENT_CONFIG_DIR;
});

describe("yaml config", () => {
  it("seeds llm.yaml on first read and applies defaults", () => {
    const loaded = config.loadLlmConfig();
    expect(fs.existsSync(path.join(dir, "llm.yaml"))).toBe(true);
    expect(loaded.baseUrl).toContain("/v1");
    expect(loaded.maxToolIterations).toBe(20);
  });

  it("round-trips edits through the file", () => {
    config.saveLlmConfig({ ...config.loadLlmConfig(), model: "qwen3:8b", temperature: 0.1 });
    expect(fs.readFileSync(path.join(dir, "llm.yaml"), "utf8")).toContain("model: qwen3:8b");
    expect(config.loadLlmConfig().model).toBe("qwen3:8b");
  });

  it("rejects a config file that does not match the schema", () => {
    fs.writeFileSync(path.join(dir, "crons.yaml"), "jobs:\n  - id: x\n", "utf8");
    expect(() => config.loadCronJobs()).toThrow(/crons\.yaml is invalid/);
  });

  it("prefers the yaml key over the environment", () => {
    process.env.OPENAI_API_KEY = "from-env";
    expect(config.resolveApiKey()).toBe("from-env");
    config.saveLlmConfig({ ...config.loadLlmConfig(), apiKey: "from-yaml" });
    expect(config.resolveApiKey()).toBe("from-yaml");
    delete process.env.OPENAI_API_KEY;
  });
});

describe("taskModels", () => {
  it("defaults to none configured", () => {
    const config = llmConfigSchema.parse({});
    expect(config.taskModels).toEqual({});
    expect(modelForTask(config, "title")).toBe("");
  });

  it("returns the model set for a task", () => {
    const config = llmConfigSchema.parse({ taskModels: { title: "small-model" } });
    expect(modelForTask(config, "title")).toBe("small-model");
  });

  it("treats a blank or whitespace value as unset", () => {
    expect(modelForTask(llmConfigSchema.parse({ taskModels: { title: "  " } }), "title")).toBe("");
  });

  it("keeps unknown task keys rather than rejecting the file", () => {
    const config = llmConfigSchema.parse({ taskModels: { title: "a", future: "b" } });
    expect(config.taskModels.future).toBe("b");
  });
});
