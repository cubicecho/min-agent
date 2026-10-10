import { graphql } from "graphql";
import { assertLlmConfigPatch, coerceLlmConfig, endpoint } from "../../server/config.ts";
import { schema } from "../../server/graphql/schema.ts";
import { llmConfigSchema, modelForTask } from "../../shared/types.ts";
import { isRecord } from "../helpers.ts";
import { storedSettings } from "./helpers.ts";

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

describe("endpoint", () => {
  /**
   * The adapter between min-agent's settings and `@cubicecho/agent-core`, which asks for the
   * narrowest thing each of its functions reads rather than for a whole config.
   */
  it("carries the base URL and the resolved key, and asks for no timeout", () => {
    const config = llmConfigSchema.parse({ baseUrl: "http://box:8080/v1", apiKey: "sk-test" });
    expect(endpoint(config)).toEqual({
      baseUrl: "http://box:8080/v1",
      apiKey: "sk-test",
      requestTimeoutSeconds: 0,
    });
  });

  it("falls back to the environment when the row holds no key", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-env";
    try {
      expect(endpoint(llmConfigSchema.parse({})).apiKey).toBe("sk-from-env");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  it("prefers the row's key to the environment's", () => {
    const previous = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "sk-from-env";
    try {
      expect(endpoint(llmConfigSchema.parse({ apiKey: "sk-test" })).apiKey).toBe("sk-test");
    } finally {
      if (previous === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });

  /**
   * Empty, not a placeholder. `@cubicecho/agent-core` fills one in for the SDK where it builds
   * a client, but its probes for a local server's window send no `Authorization` header at all
   * when the key is empty — so what this hands over with no key is something a server can see.
   */
  it("sends an empty key when neither the row nor the environment holds one", () => {
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      expect(endpoint(llmConfigSchema.parse({})).apiKey).toBe("");
    } finally {
      if (previous !== undefined) {
        process.env.OPENAI_API_KEY = previous;
      }
    }
  });
});

/**
 * The two places GraphQL says whether a key is set: the `hasApiKey` query the Config tab reads,
 * and the same answer inside `health`. Neither touches the database — both read the cached
 * settings — so the cache is filled here through a reader that hands back a row of our own.
 */
describe("hasApiKey", () => {
  const previous = process.env.OPENAI_API_KEY;

  /**
   * Asks both fields in one query.
   * @returns The `hasApiKey` query's answer and `health`'s.
   */
  const asked = async () => {
    const result = await graphql({ schema, source: "{ hasApiKey health { hasApiKey } }" });
    expect(result.errors).toBeUndefined();
    const { hasApiKey, health } = result.data ?? {};
    return { query: hasApiKey, health: isRecord(health) ? health.hasApiKey : undefined };
  };

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = previous;
    }
  });

  afterAll(async () => {
    await storedSettings({});
  });

  it("is false when neither the row nor the environment holds a key", async () => {
    await storedSettings({});
    expect(await asked()).toEqual({ query: false, health: false });
  });

  it("is true for a key in the row", async () => {
    await storedSettings({ apiKey: "sk-test" });
    expect(await asked()).toEqual({ query: true, health: true });
  });

  it("is true for a key that is only in the environment", async () => {
    await storedSettings({});
    process.env.OPENAI_API_KEY = "sk-from-env";
    expect(await asked()).toEqual({ query: true, health: true });
  });
});
