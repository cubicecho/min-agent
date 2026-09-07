import {
  type Capabilities,
  ContextOverflow,
  capabilitiesFor,
  modelCapabilitiesFor,
  resetCapabilities,
} from "@cubicecho/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendNegotiated } from "../server/agent.ts";

/**
 * What a turn does when the endpoint refuses something it can do without.
 *
 * The loop itself is agent-core's since 2.1.0, and tested there — that a server refusing two
 * things is answered in one turn, that one endpoint's refusal is not held against another, that
 * a model's refusal is not held against the model beside it. What is min-agent's, and so what is
 * tested here, is the wiring into it and the one refusal it cannot answer: a request past the
 * window, which has to reach the user saying which setting disagrees with the server.
 */

const NO_REASONING = "Unsupported parameter: 'reasoning_effort' is not supported with this model.";
const OVERFLOW =
  "This model's maximum context length is 8192 tokens, however you requested 9001 tokens";

/** A send that fails with each message in turn and then answers. Records what it was given. */
function serving(...failures: string[]) {
  const seen: Capabilities[] = [];
  let attempt = 0;
  const send = vi.fn(async (supports: Capabilities) => {
    seen.push({ ...supports });
    const failure = failures[attempt++];
    if (failure) throw new Error(failure);
    return "answered";
  });
  return { send, seen };
}

beforeEach(resetCapabilities);

describe("sendNegotiated", () => {
  it("names the model, so the refusals that are the model's are answered too", async () => {
    const supports = capabilitiesFor("https://api.openai.com/v1");
    const { send } = serving(NO_REASONING);

    // Left unnamed, this is a refusal with nothing to negotiate and the turn fails on it.
    await expect(sendNegotiated(supports, "gpt-4o", 0, send)).resolves.toBe("answered");
    expect(modelCapabilitiesFor(supports, "gpt-4o").reasoningEffort).toBe(false);
  });

  it("passes back a refusal there is nothing to negotiate about", async () => {
    const { send } = serving("model 'nope' not found");

    await expect(
      sendNegotiated(capabilitiesFor("http://box:8080/v1"), "a-model", 0, send),
    ).rejects.toThrow("not found");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send an overflowing request a second time, and says what the turn assumed", async () => {
    const { send } = serving(OVERFLOW);

    const failure = await sendNegotiated(
      capabilitiesFor("http://box:8080/v1"),
      "a-model",
      262_144,
      send,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContextOverflow);
    // The server's own words, because the number in them is the true one, plus ours: the whole
    // difficulty of this failure is that the two disagree.
    expect((failure as Error).message).toContain("maximum context length is 8192");
    expect((failure as Error).message).toContain("262.1k");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("says what to set when the window was never configured", async () => {
    const { send } = serving(OVERFLOW);

    await expect(
      sendNegotiated(capabilitiesFor("http://box:8080/v1"), "a-model", 0, send),
    ).rejects.toThrow(/Context window/);
  });
});
