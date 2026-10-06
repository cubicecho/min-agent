import { liveCharCount } from "@shared/client/live.ts";
import { contextFill, formatDuration, latestStats, statsLine } from "@shared/client/usage.ts";
import type { StoredMessage, TurnStats } from "@shared/types.ts";
import { describe, expect, it } from "vitest";

const stats: TurnStats = {
  promptTokens: 900,
  completionTokens: 187,
  totalTokens: 1087,
  model: "qwen",
  totalMs: 4600,
  ttftMs: 420,
  generationMs: 4180,
  tokensPerSecond: 44.7,
  iterations: 1,
  toolCalls: 0,
  contextTokens: 1087,
  contextLimit: 262_144,
};

describe("formatDuration", () => {
  it("scales from milliseconds to minutes", () => {
    expect(formatDuration(340)).toBe("340ms");
    expect(formatDuration(4600)).toBe("4.6s");
    expect(formatDuration(64_000)).toBe("1m 04s");
  });
});

describe("statsLine", () => {
  it("reports throughput, latency and duration", () => {
    expect(statsLine(stats)).toEqual(["187 out", "44.7 tok/s", "420ms to first token", "4.6s"]);
  });

  it("mentions tools and extra rounds only when there were some", () => {
    const withTools = { ...stats, toolCalls: 1, iterations: 2 };
    expect(statsLine(withTools)).toContain("1 tool");
    expect(statsLine(withTools)).toContain("2 rounds");
  });

  it("omits anything the server did not report", () => {
    const bare: TurnStats = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      model: "qwen",
      totalMs: 1200,
      iterations: 1,
      toolCalls: 0,
    };
    expect(statsLine(bare)).toEqual(["1.2s"]);
  });

  it("adds cost when prices are configured", () => {
    expect(statsLine(stats, { inputPer1M: 3, outputPer1M: 15 })).toContain("$0.0055");
  });
});

describe("contextFill", () => {
  it("is null until both sides are known", () => {
    expect(contextFill(null)).toBeNull();
    expect(contextFill({ ...stats, contextLimit: 0 })).toBeNull();
  });

  it("describes how full the window is", () => {
    expect(contextFill(stats)).toMatchObject({ label: "1,087 / 262.1k", percent: "0.4%" });
  });

  it("never runs past full", () => {
    expect(contextFill({ ...stats, contextTokens: 999_999 })?.ratio).toBe(1);
  });
});

describe("latestStats", () => {
  it("finds the most recent turn that carries stats", () => {
    const messages = [
      { role: "assistant", content: "one", stats: { ...stats, totalMs: 1 } },
      { role: "user", content: "two" },
      { role: "assistant", content: "three", stats: { ...stats, totalMs: 2 } },
      { role: "user", content: "four" },
    ] as StoredMessage[];
    expect(latestStats(messages)?.totalMs).toBe(2);
    expect(latestStats([])).toBeNull();
  });
});

describe("liveCharCount", () => {
  it("counts generated text but not tool payloads", () => {
    expect(
      liveCharCount([
        { kind: "reasoning", key: "0", text: "hmm" },
        { kind: "tool", key: "1", id: "a", name: "t", input: "{...}", result: "long result" },
        { kind: "text", key: "2", text: "hello" },
      ]),
    ).toBe(8);
  });
});
