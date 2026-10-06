import {
  type CatalogServer,
  PRESELECT_SCHEMA,
  PRESELECT_SYSTEM,
  preselect,
  resetAll,
} from "@cubicecho/agent-core";
import OpenAI from "openai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { endpoint } from "../../server/config.ts";
import { llmConfigSchema } from "../../shared/types.ts";

/**
 * What the tool-select model is sent, and what is made of its answer.
 *
 * The choosing is agent-core's `preselect` since min-agent stopped keeping its own, and is tested
 * there. What is pinned here is what `runTurn` relies on when it hands the call min-agent's
 * endpoint: that the reply is held to the schema, that an endpoint with no `response_format` costs
 * one refused request and is then asked in words, and that a stop is thrown rather than answered
 * with an empty list. `runTurn` itself is not driven — the call is made the way it makes it.
 */

const catalog: CatalogServer[] = [
  {
    id: "files",
    label: "Files",
    tools: [
      { name: "files__read", description: "Read a file" },
      { name: "files__write", description: "Write a file" },
    ],
  },
  { id: "web", label: "Web", tools: [{ name: "web__search", description: "Search the web" }] },
];

const config = llmConfigSchema.parse({ baseUrl: "http://box:8080/v1", apiKey: "k" });

/** A chat completion whose whole answer is `content`. */
const completion = (content: string) =>
  new Response(
    JSON.stringify({
      id: "c",
      object: "chat.completion",
      created: 0,
      model: "small",
      choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );

/**
 * An error saying `message`. A 400 is how a server refuses a field it does not take.
 *
 * @param message What the server says was wrong.
 * @param status The HTTP status it says it with.
 * @returns The response.
 */
const failure = (message: string, status = 400) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "content-type": "application/json" },
  });

/**
 * An endpoint that gives each of `replies` in turn, keeping the bodies it was sent.
 *
 * @param replies What each request is answered with, in order.
 * @returns The request bodies, filled in as they arrive.
 */
function serving(...replies: (() => Response)[]) {
  const bodies: Record<string, unknown>[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: unknown, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)));
      const reply = replies[bodies.length - 1];
      if (!reply) {
        throw new Error("asked more often than the test answers");
      }
      return reply();
    }),
  );
  return bodies;
}

/**
 * The call as `runTurn` makes it.
 *
 * @param notices Where the notices go.
 * @param signal The turn's stop.
 * @returns The names chosen.
 */
const choose = (notices: string[] = [], signal?: AbortSignal) =>
  preselect(endpoint(config), "small", catalog, "read notes.txt", {
    signal,
    onNotice: (message) => notices.push(message),
  });

// The client and what an endpoint has refused are both kept per endpoint for the life of the
// process, so each test starts from a server nothing is yet known about.
beforeEach(resetAll);
afterEach(() => vi.unstubAllGlobals());

describe("preselect", () => {
  it("holds the reply to the preselect schema", async () => {
    const bodies = serving(() => completion('{"tools":["files__read"]}'));

    expect(await choose()).toEqual(["files__read"]);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].model).toBe("small");
    expect(bodies[0].max_tokens).toBe(256);
    expect(bodies[0].response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "preselection", strict: true, schema: PRESELECT_SCHEMA },
    });
  });

  it("says the schema in the system prompt too, after the instruction it always sent", async () => {
    const bodies = serving(() => completion('{"tools":[]}'));
    await choose();

    const [system, user] = bodies[0].messages as { role: string; content: string }[];
    expect(system.content.startsWith(PRESELECT_SYSTEM)).toBe(true);
    expect(system.content).toContain(JSON.stringify(PRESELECT_SCHEMA));
    expect(user.content).toContain("files__read");
    expect(user.content).toContain("read notes.txt");
  });

  it("finds the names in a reply that wraps its JSON in prose", async () => {
    serving(() =>
      completion(
        'Sure! Here are the tools:\n```json\n{"tools": ["files__read", "nope__missing"]}\n```\nHope that helps.',
      ),
    );

    expect(await choose()).toEqual(["files__read"]);
  });

  it("spends one refused request on an endpoint with no response_format, then asks in words", async () => {
    const notices: string[] = [];
    const bodies = serving(
      () => failure("Unknown field: response_format"),
      () => completion('I would use ["web__search"].'),
      () => completion('{"tools":["files__write"]}'),
    );

    expect(await choose(notices)).toEqual(["web__search"]);
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toHaveProperty("response_format");
    expect(bodies[1]).not.toHaveProperty("response_format");
    expect(notices).toEqual([
      "small does not take response_format; asking for JSON in words instead",
    ]);

    // Latched: the next turn does not pay for the refusal again.
    expect(await choose(notices)).toEqual(["files__write"]);
    expect(bodies).toHaveLength(3);
    expect(bodies[2]).not.toHaveProperty("response_format");
  });

  it("answers a failed request with nothing and a notice, so the turn goes on", async () => {
    const notices: string[] = [];
    const bodies = serving(() => failure("the model fell over", 500));

    expect(await choose(notices)).toEqual([]);
    expect(bodies).toHaveLength(1);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/^preselect: .*the model fell over/);
  });

  it("throws a stop, which is what ends the turn it was planning for", async () => {
    const notices: string[] = [];
    const stop = new AbortController();
    stop.abort();
    serving(() => completion('{"tools":["files__read"]}'));

    await expect(choose(notices, stop.signal)).rejects.toBeInstanceOf(OpenAI.APIUserAbortError);
    expect(notices).toEqual([]);
  });
});
