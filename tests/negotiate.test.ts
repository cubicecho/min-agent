import { ContextOverflow } from "@cubicecho/agent-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Capabilities,
  capabilitiesFor,
  negotiate,
  resetCapabilities,
} from "../server/agent.ts";

/**
 * What a turn does when the endpoint refuses something it can do without.
 *
 * Both capabilities are found out the same way — by asking for them and being turned down — so
 * what is tested here is the shape of the recovery rather than either option: that a server
 * refusing both is answered in one turn instead of failing it, that what one endpoint cannot do
 * is not held against another, and that a refusal with nothing to negotiate is passed straight
 * back to the caller.
 */

const GRAMMAR = "Failed to initialize samplers: failed to parse grammar";
const NO_STREAM_OPTIONS = "Unrecognized request argument supplied: stream_options";
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

describe("negotiate", () => {
  it("answers both refusals in one turn rather than failing on the second", async () => {
    const supports = capabilitiesFor("http://box:8080/v1");
    const { send, seen } = serving(NO_STREAM_OPTIONS, GRAMMAR);

    await expect(negotiate(supports, 0, send)).resolves.toBe("answered");

    // The regression: answering only the first refusal left the second to fail the turn, so the
    // first turn against such a server was spent finding out what the next one starts knowing.
    expect(send).toHaveBeenCalledTimes(3);
    expect(seen[0]).toEqual({ usageInStream: true, strictSchemas: true });
    expect(seen[2]).toEqual({ usageInStream: false, strictSchemas: false });
  });

  it("latches what it learned, so a later turn does not ask again", async () => {
    const supports = capabilitiesFor("http://box:8080/v1");
    await negotiate(supports, 0, serving(GRAMMAR).send);

    const { send, seen } = serving();
    await negotiate(capabilitiesFor("http://box:8080/v1"), 0, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(seen[0]?.strictSchemas).toBe(false);
  });

  it("holds one endpoint's refusal against that endpoint only", async () => {
    await negotiate(capabilitiesFor("http://ollama:11434/v1"), 0, serving(GRAMMAR).send);

    const { send, seen } = serving();
    await negotiate(capabilitiesFor("https://api.openai.com/v1"), 0, send);

    expect(seen[0]).toEqual({ usageInStream: true, strictSchemas: true });
    expect(capabilitiesFor("http://ollama:11434/v1").strictSchemas).toBe(false);
  });

  it("passes back a refusal there is nothing to negotiate about", async () => {
    const { send } = serving("model 'nope' not found");

    await expect(negotiate(capabilitiesFor("http://box:8080/v1"), 0, send)).rejects.toThrow(
      "not found",
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send an overflowing request a second time, and says what the turn assumed", async () => {
    const { send } = serving(OVERFLOW);

    const failure = await negotiate(capabilitiesFor("http://box:8080/v1"), 262_144, send).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(ContextOverflow);
    // The server's own words, because the number in them is the true one, plus ours: the whole
    // difficulty of this failure is that the two disagree.
    expect((failure as Error).message).toContain("maximum context length is 8192");
    expect((failure as Error).message).toContain("262.1k");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("says what to set when the window was never configured", async () => {
    const { send } = serving(OVERFLOW);

    await expect(negotiate(capabilitiesFor("http://box:8080/v1"), 0, send)).rejects.toThrow(
      /Context window/,
    );
  });
});
