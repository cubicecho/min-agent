import { describe, expect, it } from "vitest";
import { assertLlmConfigPatch, coerceLlmConfig } from "../server/config.ts";
import { llmConfigSchema, modelForTask } from "../shared/types.ts";

/**
 * The settings live in Postgres and GraphQL checks their shape, so what is left to test here
 * is the part GraphQL cannot express: the defaults a missing column falls back to, and what
 * counts as a task model being set. `server/config.ts` itself is exercised in `store.test.ts`,
 * which has a database.
 */

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

describe("assertLlmConfigPatch", () => {
  /**
   * The regression this guards. The settings mutation is generated from the Drizzle schema, so
   * `maxTokens` was an unbounded `Int` on the way in and a `max(200000)` on the way out. A
   * larger number saved fine and then killed the next boot — `refreshLlmConfig` runs before the
   * server listens — taking down the only screen that could have put it back.
   */
  it("rejects a value the schema could not read back", () => {
    expect(() => assertLlmConfigPatch({ maxTokens: 300_000 })).toThrow(/maxTokens/);
    expect(() => assertLlmConfigPatch({ temperature: 5 })).toThrow(/temperature/);
    expect(() => assertLlmConfigPatch({ maxToolIterations: 0 })).toThrow(/maxToolIterations/);
  });

  it("names every field that is wrong, not just the first", () => {
    expect(() => assertLlmConfigPatch({ maxTokens: 0, temperature: -1 })).toThrow(
      /maxTokens.*temperature/s,
    );
  });

  /** A patch is a subset by definition — a missing field is not a missing value. */
  it("accepts a patch that sets one column", () => {
    expect(() => assertLlmConfigPatch({ model: "gpt-5" })).not.toThrow();
    expect(() => assertLlmConfigPatch({})).not.toThrow();
  });
});

describe("coerceLlmConfig", () => {
  /** A row that cannot be read is not worth a crash loop the UI cannot break out of. */
  it("drops a stored value out of range and keeps the rest", () => {
    const config = coerceLlmConfig({
      ...llmConfigSchema.parse({}),
      model: "kept",
      maxTokens: 300_000,
    });

    expect(config.maxTokens).toBe(4096);
    expect(config.model).toBe("kept");
  });

  it("drops every bad field, not one per pass", () => {
    const config = coerceLlmConfig({ maxTokens: -5, temperature: 9, model: "kept" });

    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(0.7);
    expect(config.model).toBe("kept");
  });

  it("falls back to the defaults when the row is not an object at all", () => {
    expect(coerceLlmConfig(null)).toEqual(llmConfigSchema.parse({}));
  });

  it("leaves a good row exactly as it was", () => {
    const stored = llmConfigSchema.parse({ model: "gpt-5", maxTokens: 8192 });
    expect(coerceLlmConfig(stored)).toEqual(stored);
  });
});
