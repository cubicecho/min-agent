import { breakdownRows, costOf, formatUsage, splitContext } from "@shared/client/usage.ts";
import { describe, expect, it } from "vitest";

const usage = { promptTokens: 1_000_000, completionTokens: 500_000, totalTokens: 1_500_000 };

describe("usage", () => {
  it("hides cost when no prices are configured", () => {
    expect(costOf(usage)).toBeNull();
    expect(costOf(usage, { inputPer1M: 0, outputPer1M: 0 })).toBeNull();
    expect(formatUsage(usage)).toBe("1.5M tokens");
  });

  it("prices input and output separately", () => {
    expect(costOf(usage, { inputPer1M: 3, outputPer1M: 15 })).toBeCloseTo(3 + 7.5, 5);
    expect(formatUsage(usage, { inputPer1M: 3, outputPer1M: 15 })).toBe("1.5M tokens · $10.50");
  });

  it("does not round a real cost down to $0.00", () => {
    const tiny = { promptTokens: 10, completionTokens: 5, totalTokens: 15 };
    expect(formatUsage(tiny, { inputPer1M: 3, outputPer1M: 15 })).toBe("15 tokens · <$0.01");
  });
});

describe("splitContext", () => {
  const chars = { system: 1000, tools: 2000, history: 6000, input: 1000 };

  it("scales character counts into shares of the measured total", () => {
    expect(splitContext(chars, 1000)).toEqual({
      system: 100,
      tools: 200,
      history: 600,
      input: 100,
    });
  });

  it("adds up to the measured total exactly, whatever the rounding does", () => {
    const split = splitContext({ system: 1, tools: 1, history: 1, input: 1 }, 10);
    expect(split).toBeDefined();
    const total = split ? split.system + split.tools + split.history + split.input : 0;
    expect(total).toBe(10);
  });

  it("has nothing to say without a measured total or a request", () => {
    expect(splitContext(chars, 0)).toBeUndefined();
    expect(splitContext({ system: 0, tools: 0, history: 0, input: 0 }, 500)).toBeUndefined();
  });
});

describe("breakdownRows", () => {
  it("leaves out the parts that are not there", () => {
    const rows = breakdownRows({ system: 100, tools: 0, history: 700, input: 200 });
    expect(rows.map((row) => row.key)).toEqual(["system", "history", "input"]);
    expect(rows.map((row) => row.ratio)).toEqual([0.1, 0.7, 0.2]);
    expect(rows[0].label).toBe("System prompt");
  });

  it("has nothing to draw for an empty split", () => {
    expect(breakdownRows({ system: 0, tools: 0, history: 0, input: 0 })).toEqual([]);
  });
});
