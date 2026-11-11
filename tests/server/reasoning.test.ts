import { assertLlmConfigPatch, coerceLlmConfig } from "../../server/config.ts";
import { llmConfigSchema, REASONING_EFFORTS, REASONING_REPLAYS } from "../../shared/types.ts";

/**
 * The reasoning-effort setting: the ladder it offers, and what it falls back to.
 *
 * The thing that makes the setting safe to have — a request refused because of it being sent
 * again without it, remembered against the model that refused rather than the endpoint it sits
 * on — is agent-core's `negotiate` since 2.1.0, and is tested there.
 * tests/server/run-turn-edges.test.ts covers min-agent naming the model, which is what reaches
 * that level.
 */

describe("reasoningEffort", () => {
  it("defaults to off, which is the value that sends nothing", () => {
    expect(llmConfigSchema.parse({}).reasoningEffort).toBe("off");
  });

  it("accepts every rung on the menu", () => {
    for (const effort of REASONING_EFFORTS) {
      expect(llmConfigSchema.parse({ reasoningEffort: effort }).reasoningEffort).toBe(effort);
    }
  });

  /**
   * A row written by a build with a longer ladder — or by hand — must not stop the server
   * booting, which is what `coerceLlmConfig` is for. Falling back to `off` is the right
   * landing: it is the state that leaves the parameter off the request.
   */
  it("falls back to off rather than refusing a row it cannot read", () => {
    expect(coerceLlmConfig({ reasoningEffort: "ludicrous" }).reasoningEffort).toBe("off");
  });
});

/**
 * Which replies send their thinking back. What it does to a request is in
 * tests/server/for-api.test.ts and tests/server/run-turn.test.ts; this is the setting itself.
 */
describe("reasoningReplay", () => {
  it("defaults to all, agent-core's own default", () => {
    expect(llmConfigSchema.parse({}).reasoningReplay).toBe("all");
  });

  it("accepts every policy on the menu", () => {
    for (const replay of REASONING_REPLAYS) {
      expect(llmConfigSchema.parse({ reasoningReplay: replay }).reasoningReplay).toBe(replay);
    }
  });

  /** The column is plain text, so the schema is the only thing between it and a typo. */
  it("refuses a policy it does not know on the way in, and falls back to all on the way out", () => {
    expect(() => assertLlmConfigPatch({ reasoningReplay: "some" })).toThrow(/reasoningReplay/);
    expect(coerceLlmConfig({ reasoningReplay: "some" }).reasoningReplay).toBe("all");
  });
});
