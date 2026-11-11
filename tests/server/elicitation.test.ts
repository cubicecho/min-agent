import type { ElicitHandler } from "@cubicecho/agent-mcp-pool";
import { createElicitations } from "../../server/elicitations.ts";
import type { Mcp } from "../../server/mcp.ts";
import type { Elicitation, ElicitationContent } from "../../shared/elicitation.ts";
import type { StreamEvent } from "../../shared/types.ts";
import { BRANCH_QUESTION, connectFixtures, connectFixturesWith } from "./mcp-fixture.ts";

/**
 * A server's question, from the call that caused it to the chat and back, through the real pool
 * and an in-process server whose tool asks before it answers.
 *
 * The turn's half — which chat and which call a question is put under — is pinned in
 * `run-turn.test.ts`; this is the other half: what the server is told, by whom, and when.
 */

let mcp: Mcp | undefined;

afterEach(async () => {
  await mcp?.shutdown();
  mcp = undefined;
});

/**
 * Calls `asks__push` as a turn in chat `chat-a` would, collecting what it puts on the stream.
 * `onQuestion` is handed each question as it lands.
 */
function push(servers: Mcp, onQuestion: (question: Elicitation) => void, signal?: AbortSignal) {
  const events: StreamEvent[] = [];
  const emit = (event: StreamEvent) => {
    events.push(event);
    if (event.type === "elicitation") {
      onQuestion(event.elicitation);
    }
  };
  const asking: ElicitHandler = (serverId, params, extra) =>
    servers.ask(
      { sessionId: "chat-a", toolUseId: "c1", serverId, server: servers.labelOf(serverId) },
      params,
      extra.signal,
      emit,
    );
  const result = servers.call("asks__push", {}, signal, undefined, asking);
  return { events, result };
}

test("a question a call's server asks reaches the chat, and the person's answer reaches the server", async () => {
  mcp = await connectFixtures("asks");
  const servers = mcp;
  const { events, result } = push(servers, (question) => {
    servers.answer("chat-a", question.id, {
      action: "accept",
      content: { branch: "dev", force: true },
    });
  });

  expect(JSON.parse(await result)).toEqual({
    action: "accept",
    content: { branch: "dev", force: true },
  });
  const [asked, ended] = events;
  expect(asked).toEqual({
    type: "elicitation",
    elicitation: {
      id: expect.any(String),
      toolUseId: "c1",
      serverId: "asks",
      // Who is asking, as the person knows the server.
      server: "asks server",
      message: BRANCH_QUESTION.message,
      schema: BRANCH_QUESTION.requestedSchema,
    },
  });
  expect(ended).toEqual({
    type: "elicitation_end",
    id: asked.type === "elicitation" ? asked.elicitation.id : "",
    action: "accept",
  });
});

test("a decline reaches the server as a decline", async () => {
  mcp = await connectFixtures("asks");
  const servers = mcp;
  const { result } = push(servers, (question) => {
    servers.answer("chat-a", question.id, { action: "decline" });
  });
  expect(JSON.parse(await result)).toEqual({ action: "decline" });
});

test("another chat cannot answer a question, and the one it was asked in still can", async () => {
  mcp = await connectFixtures("asks");
  const servers = mcp;
  const tried: boolean[] = [];
  const { result } = push(servers, (question) => {
    tried.push(
      servers.answer("chat-b", question.id, { action: "accept", content: { branch: "main" } }),
    );
    tried.push(servers.answer("chat-a", question.id, { action: "cancel" }));
  });
  expect(JSON.parse(await result)).toEqual({ action: "cancel" });
  expect(tried).toEqual([false, true]);
});

test("an accept that does not fit the form is refused, and the question keeps waiting", async () => {
  mcp = await connectFixtures("asks");
  const servers = mcp;
  const refusals: string[] = [];
  const { result } = push(servers, (question) => {
    const wrong: ElicitationContent[] = [{}, { branch: "nightly" }, { branch: "main", extra: 1 }];
    for (const content of wrong) {
      try {
        servers.answer("chat-a", question.id, { action: "accept", content });
      } catch (error) {
        refusals.push((error as Error).message);
      }
    }
    servers.answer("chat-a", question.id, { action: "accept", content: { branch: "main" } });
  });

  expect(JSON.parse(await result)).toEqual({ action: "accept", content: { branch: "main" } });
  expect(refusals).toEqual([
    "branch: Branch is required.",
    "branch: Pick one of the choices.",
    'The question has no field "extra".',
  ]);
});

test("stopping the turn puts the question away, and tells the chat it is gone", async () => {
  mcp = await connectFixtures("asks");
  const controller = new AbortController();
  const { events, result } = push(mcp, () => controller.abort(), controller.signal);

  // Said as the stop it was: before agent-mcp-pool 3.16.2 the SDK's wrapping of the abort came
  // out as a timeout, and a stopped call's card claimed it had run out of time.
  await expect(result).rejects.toMatchObject({ code: "aborted" });
  expect(events.map((event) => event.type)).toEqual(["elicitation", "elicitation_end"]);
  expect(events[1]).toMatchObject({ action: "cancel" });
  expect(mcp.answer("chat-a", "anything", { action: "accept" })).toBe(false);
});

test("the time a person takes to answer is not counted against the call's own", async () => {
  // A call gets 50ms of its own here, and the person takes four times that.
  mcp = await connectFixturesWith({ callTimeoutMs: 50 }, "asks");
  const servers = mcp;
  const { result } = push(servers, (question) => {
    setTimeout(() => servers.answer("chat-a", question.id, { action: "decline" }), 200);
  });
  expect(JSON.parse(await result)).toEqual({ action: "decline" });
});

test("an answer to a question that is no longer waiting is false, not an error", () => {
  const questions = createElicitations();
  expect(questions.answer("chat-a", "gone", { action: "accept", content: {} })).toBe(false);
});

test("a question nobody answers in time is put away as a cancel", async () => {
  const questions = createElicitations({ waitMs: 10 });
  const events: StreamEvent[] = [];
  const answer = await questions.ask(
    { sessionId: "chat-a", toolUseId: "c1", serverId: "asks", server: "asks server" },
    BRANCH_QUESTION,
    new AbortController().signal,
    (event) => events.push(event),
  );
  expect(answer).toEqual({ action: "cancel" });
  expect(events.at(-1)).toMatchObject({ type: "elicitation_end", action: "cancel" });
  expect(questions.waiting()).toBe(0);
});

test("a link a server asks the person to open is declined, since only forms are offered", async () => {
  const questions = createElicitations();
  const events: StreamEvent[] = [];
  const answer = await questions.ask(
    { sessionId: "chat-a", toolUseId: "c1", serverId: "asks", server: "asks server" },
    { mode: "url", message: "Sign in", url: "https://example.com", elicitationId: "e1" },
    new AbortController().signal,
    (event) => events.push(event),
  );
  expect(answer).toEqual({ action: "decline" });
  expect(events).toEqual([]);
});
