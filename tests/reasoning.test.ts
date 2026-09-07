import { describe, expect, it } from "vitest";
import { learnFromRefusal } from "../server/agent.ts";
import { coerceLlmConfig } from "../server/config.ts";
import { llmConfigSchema, REASONING_EFFORTS } from "../shared/types.ts";

/**
 * The reasoning-effort setting, and the thing that makes it safe to have: a request that is
 * refused because of it is sent again without it.
 *
 * `learnFromRefusal` keeps its notes in module state, so every case below uses a model name of
 * its own — that is the point of the design as much as it is a precaution here. The two
 * server-wide flags it also holds are deliberately not touched: they are once-per-process by
 * design, and a test that tripped one would be changing what a later test starts from.
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

describe("learnFromRefusal", () => {
  it("notes a model that will not be told how hard to think, once", () => {
    const detail = "Unsupported parameter: 'reasoning_effort' is not supported with this model.";
    expect(learnFromRefusal(detail, "no-thoughts")).toBe(true);
    // The second time is the same complaint about something already dropped, so there is
    // nothing left to try and the error belongs to the caller.
    expect(learnFromRefusal(detail, "no-thoughts")).toBe(false);
  });

  it("keeps the note against the model rather than the run", () => {
    const detail = "Unrecognized request argument supplied: reasoning_effort";
    expect(learnFromRefusal(detail, "old-model")).toBe(true);
    // A sticky flag would have answered `false` here, and the model that *can* reason would
    // have quietly stopped being asked to.
    expect(learnFromRefusal(detail, "new-model")).toBe(true);
  });

  it("moves to max_completion_tokens when the server names it", () => {
    const detail =
      "Unsupported parameter: 'max_tokens' is not supported with this model. " +
      "Use 'max_completion_tokens' instead.";
    expect(learnFromRefusal(detail, "reasoner")).toBe(true);
  });

  /**
   * `max_tokens` on its own is also how a server says the number was too large, and the answer
   * to that is not to send the same number under a different name — it is to let the error out
   * so the person who typed it can see it.
   */
  it("does not read a complaint about the value as a complaint about the spelling", () => {
    const detail = "max_tokens is too large: 200000. This model supports at most 16384.";
    expect(learnFromRefusal(detail, "small-window")).toBe(false);
  });

  it("drops our temperature for a model that only takes its own", () => {
    const detail =
      "Unsupported value: 'temperature' does not support 0.7 with this model. " +
      "Only the default (1) is supported.";
    expect(learnFromRefusal(detail, "fixed-temp")).toBe(true);
    expect(learnFromRefusal(detail, "fixed-temp")).toBe(false);
  });

  /**
   * The case the loop exists for: an OpenAI reasoning model has two of these waiting, and
   * learning one thing per turn would have meant the second refusal reached the user.
   */
  it("learns both of the refusals one reasoning model has waiting", () => {
    expect(
      learnFromRefusal(
        "Unsupported parameter: 'max_tokens' is not supported with this model. " +
          "Use 'max_completion_tokens' instead.",
        "gpt-5-ish",
      ),
    ).toBe(true);
    expect(
      learnFromRefusal(
        "Unsupported value: 'temperature' does not support 0.7 with this model.",
        "gpt-5-ish",
      ),
    ).toBe(true);
  });

  it("says no to a refusal it has no answer for", () => {
    expect(learnFromRefusal("model `nonesuch` not found", "missing")).toBe(false);
  });
});
