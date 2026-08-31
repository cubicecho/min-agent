import { describe, expect, it } from "vitest";
import { applyEvent, type LivePart } from "@/lib/live";

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

  it("starts a fresh text part after a tool call", () => {
    const parts = fold([
      { type: "text_delta", text: "first" },
      { type: "tool_use", id: "call_1", name: "fs__read", input: "{}" },
      { type: "text_delta", text: "second" },
    ]);

    expect(parts.map((part) => part.kind)).toEqual(["text", "tool", "text"]);
  });
});
