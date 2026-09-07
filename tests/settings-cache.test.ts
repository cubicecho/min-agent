import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The settings cache, exercised the way it is actually written to: through the generated
 * GraphQL mutation.
 *
 * This needs a database because the bug it guards only exists when there is one. The mutation
 * runs inside a transaction — one the `onWrite` hook itself causes to open — and the hook used
 * to re-read the row through the module-level `db`, taking a different connection out of the
 * pool. That connection cannot see an uncommitted write, so the refresh faithfully read the
 * row as it was *before* the save and the cache ran exactly one write behind: change the
 * reasoning effort, and the next turn ran on the previous one.
 *
 * `TEST_DATABASE_URL` has to be set on purpose, the same as `store.test.ts`: this migrates the
 * database it names and rewrites the settings row before every test.
 */
const url = process.env.TEST_DATABASE_URL;

let schema: GraphQLSchema;
let loadLlmConfig: typeof import("../server/config.ts")["loadLlmConfig"];
let refreshLlmConfig: typeof import("../server/config.ts")["refreshLlmConfig"];

/** Patches the settings row through the generated mutation, exactly as the Config screen does. */
const save = (set: Record<string, unknown>) =>
  graphql({
    schema,
    source: `
      mutation SaveConfig($set: UpdateSettingInput!) {
        updateSettingSingle(where: { id: { eq: "default" } }, set: $set) { id }
      }
    `,
    variableValues: { set },
  });

describe.skipIf(!url)("the settings cache", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await (await import("../server/db/migrate.ts")).runMigrations();
    ({ loadLlmConfig, refreshLlmConfig } = await import("../server/config.ts"));
    schema = (await import("../server/graphql/schema.ts")).schema;
  });

  beforeEach(async () => {
    await save({ reasoningEffort: "off", model: "", maxToolIterations: 20 });
    await refreshLlmConfig();
  });

  /**
   * The regression. One save, then read the cache — no second save, no restart, nothing else
   * to hide behind. Before the fix this answered `off`, the value the row had held a moment
   * earlier.
   */
  it("has the new value the moment the mutation returns", async () => {
    const result = await save({ reasoningEffort: "high" });

    expect(result.errors).toBeUndefined();
    expect(loadLlmConfig().reasoningEffort).toBe("high");
  });

  /** And keeps having it, rather than being a read that happened to race the commit. */
  it("holds the value a fresh read of the row would give", async () => {
    await save({ model: "gpt-5", maxToolIterations: 7 });

    expect(loadLlmConfig().model).toBe("gpt-5");
    expect((await refreshLlmConfig()).maxToolIterations).toBe(7);
  });

  /**
   * The `before` hook checks bounds the generated input type cannot express, and throwing from
   * it rolls the mutation back. Nothing should reach the cache, since nothing reached the row —
   * which is the half of the refresh-inside-the-transaction trade that has to hold.
   *
   * And the reason reaches the client, rather than the flat "Internal server error" the
   * generated resolvers mask everything else with — see `onError` in `graphql/schema.ts`.
   */
  it("is untouched by a write the bounds check refused", async () => {
    await save({ reasoningEffort: "high" });
    const result = await save({ maxTokens: 300_000 });

    expect(result.errors?.[0].message).toMatch(/maxTokens/);
    expect(result.errors?.[0].extensions.code).toBe("BAD_USER_INPUT");
    expect(loadLlmConfig().reasoningEffort).toBe("high");
    expect(loadLlmConfig().maxTokens).toBe(4096);
    expect((await refreshLlmConfig()).maxTokens).toBe(4096);
  });

  it("leaves the columns the patch did not name alone", async () => {
    await save({ model: "gpt-5" });
    await save({ reasoningEffort: "low" });

    expect(loadLlmConfig().model).toBe("gpt-5");
    expect(loadLlmConfig().reasoningEffort).toBe("low");
  });
});
