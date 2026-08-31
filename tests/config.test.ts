import { describe, expect, it } from "vitest";
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
