import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Capabilities,
  capabilitiesFor,
  modelCapabilitiesFor,
  negotiate,
  resetCapabilities,
} from "../server/agent.ts";
import { coerceLlmConfig } from "../server/config.ts";
import { llmConfigSchema, REASONING_EFFORTS } from "../shared/types.ts";

/**
 * The reasoning-effort setting, and the thing that makes it safe to have: a request refused
 * because of it is sent again without it.
 *
 * `negotiate` covers the endpoint's own capabilities; what is tested here is the level below —
 * that a refusal is remembered against the *model* that gave it, since a model that cannot
 * reason sits on the same endpoint as one that can.
 */

const NO_REASONING = "Unsupported parameter: 'reasoning_effort' is not supported with this model.";
const WANTS_MODERN_LIMIT =
  "Unsupported parameter: 'max_tokens' is not supported with this model. " +
  "Use 'max_completion_tokens' instead.";
const FIXED_TEMPERATURE =
  "Unsupported value: 'temperature' does not support 0.7 with this model. " +
  "Only the default (1) is supported.";

const ENDPOINT = "https://api.openai.com/v1";

/** A send that fails with each message in turn and then answers. */
function serving(...failures: string[]) {
  let attempt = 0;
  return vi.fn(async (_supports: Capabilities) => {
    const failure = failures[attempt++];
    if (failure) throw new Error(failure);
    return "answered";
  });
}

beforeEach(resetCapabilities);

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

describe("negotiating what a model will take", () => {
  it("stops asking a model to think once it has said it cannot", async () => {
    const supports = capabilitiesFor(ENDPOINT);
    await negotiate(supports, "gpt-4o", 0, serving(NO_REASONING));

    expect(modelCapabilitiesFor(supports, "gpt-4o").reasoningEffort).toBe(false);
  });

  /**
   * The reason the notes hang off the model rather than the endpoint. One OpenAI key reaches
   * both of these, and a flag on the endpoint would have let the first turn switch reasoning
   * off for the second — the setting still reading "high", with nothing behind it.
   */
  it("holds one model's refusal against that model only", async () => {
    const supports = capabilitiesFor(ENDPOINT);
    await negotiate(supports, "gpt-4o", 0, serving(NO_REASONING));

    expect(modelCapabilitiesFor(supports, "gpt-5").reasoningEffort).toBe(true);
  });

  /** And not against the same model reached somewhere else, which may be a different model. */
  it("keeps the note on the endpoint it was learned from", async () => {
    await negotiate(capabilitiesFor(ENDPOINT), "gpt-4o", 0, serving(NO_REASONING));

    expect(
      modelCapabilitiesFor(capabilitiesFor("http://proxy:8080/v1"), "gpt-4o").reasoningEffort,
    ).toBe(true);
  });

  /**
   * The case the loop exists for: a reasoning model has two refusals of its own waiting, and
   * answering one per turn would have meant the second was what the user saw.
   */
  it("answers both of a reasoning model's refusals in one turn", async () => {
    const supports = capabilitiesFor(ENDPOINT);
    const send = serving(WANTS_MODERN_LIMIT, FIXED_TEMPERATURE);

    await expect(negotiate(supports, "gpt-5", 0, send)).resolves.toBe("answered");

    const takes = modelCapabilitiesFor(supports, "gpt-5");
    expect(takes.legacyTokenLimit).toBe(false);
    expect(takes.chosenTemperature).toBe(false);
    // The effort itself survived: it was never what was being refused.
    expect(takes.reasoningEffort).toBe(true);
    expect(send).toHaveBeenCalledTimes(3);
  });

  /**
   * `max_tokens` on its own is also how a server says the number was too large, and the answer
   * to that is not to send the same number under a different name — it is to let the error out
   * so the person who typed it can see it.
   */
  it("does not read a complaint about the value as one about the spelling", async () => {
    const supports = capabilitiesFor(ENDPOINT);
    const tooLarge = "max_tokens is too large: 200000. This model supports at most 16384.";

    await expect(negotiate(supports, "small-window", 0, serving(tooLarge))).rejects.toThrow(
      tooLarge,
    );
    expect(modelCapabilitiesFor(supports, "small-window").legacyTokenLimit).toBe(true);
  });

  /** A refusal already answered has nothing left to try, so it goes back to the caller. */
  it("gives up when the same refusal comes back", async () => {
    const supports = capabilitiesFor(ENDPOINT);

    await expect(
      negotiate(supports, "gpt-4o", 0, serving(NO_REASONING, NO_REASONING)),
    ).rejects.toThrow(NO_REASONING);
  });
});
