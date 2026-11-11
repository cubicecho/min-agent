import { applyEvent, type LivePart, waitingQuestions } from "@shared/client/live.ts";

const fold = (events: Parameters<typeof applyEvent>[1][]) =>
  events.reduce<LivePart[]>((parts, event) => applyEvent(parts, event), []);

describe("applyEvent", () => {
  it("merges consecutive text deltas into one part", () => {
    expect(
      fold([
        { type: "text_delta", text: "Hel" },
        { type: "text_delta", text: "lo" },
      ]),
    ).toEqual([{ kind: "text", key: "0", text: "Hello" }]);
  });

  it("keeps reasoning separate from the answer, in arrival order", () => {
    expect(
      fold([
        { type: "reasoning_delta", text: "hmm" },
        { type: "text_delta", text: "hi" },
      ]),
    ).toEqual([
      { kind: "reasoning", key: "0", text: "hmm" },
      { kind: "text", key: "1", text: "hi" },
    ]);
  });

  it("attaches a result to the matching tool call", () => {
    const parts = fold([
      { type: "tool_use", id: "call_1", name: "fs__read", input: '{"path":"/tmp"}' },
      { type: "tool_use", id: "call_2", name: "fs__list", input: "{}" },
      { type: "tool_result", toolUseId: "call_2", content: "boom", isError: true },
    ]);

    expect(parts[0]).not.toHaveProperty("result");
    expect(parts[1]).toMatchObject({ id: "call_2", result: "boom", isError: true });
  });

  it("puts what a server logged on the card of the call it logged during, in order", () => {
    const parts = fold([
      { type: "tool_use", id: "call_1", name: "fs__read", input: "{}" },
      { type: "tool_use", id: "call_2", name: "fs__list", input: "{}" },
      { type: "server_log", toolUseId: "call_2", level: "warning", text: "slow disk" },
      { type: "server_log", toolUseId: "call_2", level: "error", text: "gave up on /mnt" },
      { type: "tool_result", toolUseId: "call_2", content: "a.txt", isError: false },
    ]);

    expect(parts[0]).not.toHaveProperty("logs");
    expect(parts[1]).toMatchObject({
      result: "a.txt",
      logs: [
        { level: "warning", text: "slow disk" },
        { level: "error", text: "gave up on /mnt" },
      ],
    });
  });

  it("puts a server's question in the turn, and marks it gone once it ends", () => {
    const question = (id: string) => ({
      id,
      toolUseId: "call_1",
      serverId: "git",
      server: "Git",
      message: "Which branch?",
      schema: {},
    });
    const asked = fold([
      { type: "tool_use", id: "call_1", name: "git__push", input: "{}" },
      { type: "elicitation", elicitation: question("q1") },
      { type: "elicitation", elicitation: question("q2") },
    ]);
    expect(asked[1]).toEqual({ kind: "question", key: "1", elicitation: question("q1") });
    // Both are waiting on the person, which is what the turn says while they are.
    expect(waitingQuestions(asked).map((waiting) => waiting.id)).toEqual(["q1", "q2"]);

    const ended = [{ type: "elicitation_end", id: "q1", action: "cancel" } as const].reduce(
      applyEvent,
      asked,
    );
    expect(ended[1]).toMatchObject({ kind: "question", answer: "cancel" });
    expect(waitingQuestions(ended).map((waiting) => waiting.id)).toEqual(["q2"]);
  });

  it("starts a fresh text part after a tool call", () => {
    const parts = fold([
      { type: "text_delta", text: "first" },
      { type: "tool_use", id: "call_1", name: "fs__read", input: "{}" },
      { type: "text_delta", text: "second" },
    ]);

    expect(parts.map((part) => part.kind)).toEqual(["text", "tool", "text"]);
  });
});
