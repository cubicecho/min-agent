import { describe, expect, it } from "vitest";
import { coerceLlmConfig } from "../server/config.ts";
import { llmConfigSchema, REASONING_EFFORTS } from "../shared/types.ts";

/**
 * The reasoning-effort setting: the ladder it offers, and what it falls back to.
 *
 * The thing that makes the setting safe to have — a request refused because of it being sent
 * again without it, remembered against the model that refused rather than the endpoint it sits
 * on — is agent-core's `negotiate` since 2.1.0, and is tested there. `sendNegotiated` in
 * tests/negotiate.test.ts covers min-agent naming the model, which is what reaches that level.
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
