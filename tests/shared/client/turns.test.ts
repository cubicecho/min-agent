import { createTurnStore, IDLE_TURN, turnActivity } from "@shared/client/turns.ts";

/** A store whose frames run when the test says so. */
function store() {
  const frames: (() => void)[] = [];
  const turns = createTurnStore((flush) => frames.push(flush));
  const frame = () => {
    for (const flush of frames.splice(0)) {
      flush();
    }
  };
  return { turns, frame, frames };
}

const start = (turns: ReturnType<typeof createTurnStore>, id: string, prompt = "hi") =>
  turns.start(id, { prompt, asked: 2, controller: new AbortController(), startedAt: 1 });

describe("createTurnStore", () => {
  it("is idle for a chat that has never sent anything", () => {
    const { turns } = store();
    expect(turns.get("a")).toBe(IDLE_TURN);
    expect(turns.get(null)).toBe(IDLE_TURN);
  });

  it("keeps each chat's turn apart while both stream", () => {
    const { turns, frame } = store();
    start(turns, "a", "first");
    start(turns, "b", "second");

    turns.push("a", { type: "text_delta", text: "for a" });
    turns.push("b", { type: "text_delta", text: "for b" });
    frame();

    expect(turns.get("a")).toMatchObject({ prompt: "first", asked: 2, startedAt: 1 });
    expect(turns.get("a").parts).toEqual([{ kind: "text", key: "0", text: "for a" }]);
    expect(turns.get("b").parts).toEqual([{ kind: "text", key: "0", text: "for b" }]);
  });

  it("folds a burst of events into one frame and one notification", () => {
    const { turns, frame, frames } = store();
    start(turns, "a");
    const listener = vi.fn();
    turns.subscribe(listener);

    turns.push("a", { type: "text_delta", text: "Hel" });
    turns.push("a", { type: "text_delta", text: "lo" });
    expect(frames).toHaveLength(1);
    expect(turns.get("a").parts).toEqual([]);

    frame();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(turns.get("a").parts).toEqual([{ kind: "text", key: "0", text: "Hello" }]);
  });

  it("hands back the same object for a chat nothing happened to", () => {
    const { turns, frame } = store();
    start(turns, "a");
    start(turns, "b");
    const before = turns.get("b");

    turns.push("a", { type: "text_delta", text: "x" });
    frame();

    expect(turns.get("b")).toBe(before);
  });

  it("takes the stats and an error off the stream", () => {
    const { turns, frame } = store();
    start(turns, "a");
    const stats = { inputTokens: 1 } as never;

    turns.push("a", { type: "stats", stats });
    turns.push("a", { type: "error", message: "boom" });
    frame();

    expect(turns.get("a")).toMatchObject({ stats, failure: "boom" });
  });

  it("goes idle when the turn ends, keeping only why it failed", () => {
    const { turns, frame } = store();
    start(turns, "a");
    start(turns, "b");
    turns.push("a", { type: "text_delta", text: "x" });
    turns.fail("b", "offline");

    turns.end("a");
    turns.end("b");
    frame();

    expect(turns.get("a")).toBe(IDLE_TURN);
    expect(turns.get("b")).toMatchObject({ prompt: null, parts: [], failure: "offline" });
  });

  it("forgets the last failure when the next turn goes out", () => {
    const { turns } = store();
    start(turns, "a");
    turns.fail("a", "offline");
    turns.end("a");

    start(turns, "a");
    expect(turns.get("a").failure).toBeNull();
  });

  it("drops events that land after the turn has ended", () => {
    const { turns, frame } = store();
    start(turns, "a");
    turns.end("a");

    turns.push("a", { type: "text_delta", text: "late" });
    frame();

    expect(turns.get("a")).toBe(IDLE_TURN);
  });
});

describe("turnActivity", () => {
  const question = {
    id: "q1",
    toolUseId: "call_1",
    serverId: "s",
    server: "s",
    message: "Which?",
    schema: {},
  };

  it("is idle with no turn, running while answering, waiting on an open question", () => {
    const { turns, frame } = store();
    expect(turnActivity(turns.get("a"))).toBe("idle");

    start(turns, "a");
    expect(turnActivity(turns.get("a"))).toBe("running");

    turns.push("a", { type: "elicitation", elicitation: question });
    frame();
    expect(turnActivity(turns.get("a"))).toBe("waiting");

    turns.push("a", { type: "elicitation_end", id: "q1", action: "accept" });
    frame();
    expect(turnActivity(turns.get("a"))).toBe("running");

    turns.end("a");
    expect(turnActivity(turns.get("a"))).toBe("idle");
  });
});
