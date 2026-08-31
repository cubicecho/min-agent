import { costOf, formatUsage } from "@shared/client/usage.ts";
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
