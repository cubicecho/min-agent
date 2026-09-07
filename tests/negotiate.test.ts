import {
  ContextOverflow,
  capabilitiesFor,
  modelCapabilitiesFor,
  resetCapabilities,
} from "@cubicecho/agent-core";
import OpenAI from "openai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendTurn } from "../server/agent.ts";

/**
 * What one round trip does when the endpoint refuses something it can do without, or loses the
 * request altogether.
 *
 * All three loops are agent-core's `runTurn` since 1.3.0, and tested there — that a server
 * refusing two things is answered in one turn, that one endpoint's refusal is not held against
 * another, that a model's refusal is not held against the model beside it, that nothing is sent
 * again once tokens have arrived. What is min-agent's, and so what is tested here, is the wiring
 * into it — the model it names, the attempt budget it sets — and the one refusal none of it can
 * answer: a request past the window, which has to reach the user saying which setting disagrees
 * with the server.
 */

const NO_REASONING = "Unsupported parameter: 'reasoning_effort' is not supported with this model.";
const OVERFLOW =
  "This model's maximum context length is 8192 tokens, however you requested 9001 tokens";

/** The smallest body that is still a streaming chat request. */
const body = (): OpenAI.ChatCompletionCreateParamsStreaming => ({
  model: "a-model",
  stream: true,
  messages: [{ role: "user", content: "hi" }],
});

/** One chunk, which is all these tests need the server to have said. */
async function* answering() {
  yield {
    choices: [{ index: 0, delta: { content: "answered" }, finish_reason: null }],
  } as unknown as OpenAI.ChatCompletionChunk;
}

/**
 * A client that fails with each of `failures` in turn and then answers. A string is a plain
 * refusal — something the request said — and an `Error` is passed through as it is, which is how
 * a lost request gets in.
 */
function serving(...failures: (string | Error)[]) {
  let attempt = 0;
  const create = vi.fn(async () => {
    const failure = failures[attempt++];
    if (failure) throw typeof failure === "string" ? new Error(failure) : failure;
    return answering();
  });
  const client = { chat: { completions: { create } } } as unknown as OpenAI;
  return { client, create, request: body };
}

/** A request that never landed: the one class of failure worth simply sending again. */
const lost = () => new OpenAI.APIConnectionError({ message: "socket hang up" });

beforeEach(resetCapabilities);

describe("sendTurn", () => {
  it("names the model, so the refusals that are the model's are answered too", async () => {
    const supports = capabilitiesFor("https://api.openai.com/v1");
    const { client, request } = serving(NO_REASONING);

    // Left unnamed, this is a refusal with nothing to negotiate and the turn fails on it.
    const turn = await sendTurn(client, request, { supports, model: "gpt-4o", contextLimit: 0 });

    expect(turn.content).toBe("answered");
    expect(modelCapabilitiesFor(supports, "gpt-4o").reasoningEffort).toBe(false);
  });

  it("passes back a refusal there is nothing to negotiate about", async () => {
    const { client, create, request } = serving("model 'nope' not found");

    await expect(
      sendTurn(client, request, {
        supports: capabilitiesFor("http://box:8080/v1"),
        model: "a-model",
        contextLimit: 0,
      }),
    ).rejects.toThrow("not found");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("sends a lost request again, and gives up after the turn's own budget", async () => {
    const { client, create, request } = serving(lost(), lost(), lost());

    await expect(
      sendTurn(client, request, {
        supports: capabilitiesFor("http://box:8080/v1"),
        model: "a-model",
        contextLimit: 0,
      }),
    ).rejects.toThrow("socket hang up");
    // Two retries on top of the attempt that was asked for. A refusal spends none of them, which
    // is what the test above pins from the other side.
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("does not send an overflowing request a second time, and says what the turn assumed", async () => {
    const { client, create, request } = serving(OVERFLOW);

    const failure = await sendTurn(client, request, {
      supports: capabilitiesFor("http://box:8080/v1"),
      model: "a-model",
      contextLimit: 262_144,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ContextOverflow);
    // The server's own words, because the number in them is the true one, plus ours: the whole
    // difficulty of this failure is that the two disagree.
    expect((failure as Error).message).toContain("maximum context length is 8192");
    expect((failure as Error).message).toContain("262.1k");
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("says what to set when the window was never configured", async () => {
    const { client, request } = serving(OVERFLOW);

    await expect(
      sendTurn(client, request, {
        supports: capabilitiesFor("http://box:8080/v1"),
        model: "a-model",
        contextLimit: 0,
      }),
    ).rejects.toThrow(/Context window/);
  });
});
