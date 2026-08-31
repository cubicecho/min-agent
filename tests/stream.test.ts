import { createClient } from "@shared/client/api.ts";
import type { StreamEvent } from "@shared/types.ts";
import { describe, expect, it } from "vitest";

/** A fetch that answers with the given chunks as one server-sent-events body. */
function serving(chunks: string[]) {
  const events: StreamEvent[] = [];
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });

  const { streamTurn } = createClient({
    baseUrl: "/graphql",
    fetch: (async () => new Response(body, { status: 200 })) as unknown as typeof fetch,
  });

  return {
    events,
    run: () =>
      streamTurn({
        sessionId: "s",
        prompt: "hi",
        onEvent: (event) => events.push(event),
      }),
  };
}

/**
 * What the server actually puts on the wire: a subscription payload wrapping one flat
 * `TurnEvent`, whose unset fields come back as nulls the client is expected to drop.
 */
const frame = (seq: number, event: StreamEvent) =>
  `data: ${JSON.stringify({ data: { turn: { seq, text: null, id: null, stats: null, ...event } } })}\n\n`;

describe("streamTurn", () => {
  it("reads events that arrive split across chunk boundaries", async () => {
    const whole = frame(1, { type: "text_delta", text: "hello" });
    const { events, run } = serving([whole.slice(0, 9), whole.slice(9)]);
    await run();

    expect(events).toEqual([{ type: "text_delta", text: "hello" }]);
  });

  it("skips the keep-alive comments that hold an idle turn open", async () => {
    const { events, run } = serving([
      ": keep-alive\n\n",
      frame(1, { type: "text_delta", text: "hi" }),
      ": keep-alive\n\n",
      frame(2, { type: "done" }),
    ]);
    await run();

    expect(events).toEqual([{ type: "text_delta", text: "hi" }, { type: "done" }]);
  });

  it("takes the data line out of a frame that carries a comment too", async () => {
    const { events, run } = serving([`: keep-alive\n${frame(1, { type: "done" })}`]);
    await run();

    expect(events).toEqual([{ type: "done" }]);
  });

  it("raises the error a subscription reports instead of dropping the turn", async () => {
    const { run } = serving([
      `data: ${JSON.stringify({ errors: [{ message: "no session" }] })}\n\n`,
    ]);
    await expect(run()).rejects.toThrow("no session");
  });
});
