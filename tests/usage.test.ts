import {
  breakdownRows,
  costOf,
  formatUsage,
  measureRequest,
  splitContext,
} from "@shared/client/usage.ts";
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
    // Every part is named in the answer, including the ones this request had none of: the
    // rows are drawn from what is non-zero, not from what is present.
    expect(splitContext(chars, 1000)).toEqual({
      system: 100,
      catalogue: 0,
      tools: 200,
      summary: 0,
      history: 600,
      historyTools: 0,
      input: 100,
      inputTools: 0,
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

describe("measureRequest", () => {
  const say = (role: string, content: string) => ({ role, content });
  const asked = { role: "assistant", content: "let me look", tool_calls: [{ id: "1", fn: "read" }] };
  const returned = { role: "tool", tool_call_id: "1", content: "x".repeat(500) };

  it("counts the catalogue as the part of the system message the prompt is not", () => {
    const split = measureRequest({
      system: "You are helpful.\n\nTools: read, write",
      systemPrompt: "You are helpful.",
      tools: [],
      history: [say("user", "hello")],
      turnLength: 1,
    });
    expect(split.system).toBe("You are helpful.".length);
    expect(split.catalogue).toBe("\n\nTools: read, write".length);
    expect(split.tools).toBe(0);
  });

  it("splits tool traffic away from what was said, in both halves", () => {
    const split = measureRequest({
      system: "S",
      systemPrompt: "S",
      tools: [{ name: "read" }],
      history: [say("user", "old"), asked, returned, say("user", "new"), asked, returned],
      turnLength: 3,
    });
    // A result is tool traffic entire; an assistant's words stay with the conversation and
    // only the calls it made are counted against the tools.
    expect(split.historyTools).toBe(split.inputTools);
    expect(split.historyTools).toBeGreaterThan(500);
    expect(split.history).toBeGreaterThan(0);
    expect(split.input).toBeGreaterThan(0);
    expect(split.tools).toBe(JSON.stringify([{ name: "read" }]).length);
  });

  it("gives the folded head its own share, and does not count it as history too", () => {
    const summary = say("system", "what happened earlier");
    const split = measureRequest({
      system: "S",
      systemPrompt: "S",
      tools: [],
      history: [summary, say("user", "then"), say("user", "now")],
      turnLength: 1,
      compacted: true,
    });
    expect(split.summary).toBe(JSON.stringify(summary).length);
    expect(split.history).toBe(JSON.stringify(say("user", "then")).length);
    expect(split.input).toBe(JSON.stringify(say("user", "now")).length);
  });

  it("puts a turn with no history all in this turn", () => {
    const split = measureRequest({
      system: "S",
      systemPrompt: "S",
      tools: [],
      history: [say("user", "hello")],
      turnLength: 1,
    });
    expect(split.history).toBe(0);
    expect(split.historyTools).toBe(0);
    expect(split.summary).toBe(0);
    expect(split.input).toBeGreaterThan(0);
  });
});

describe("a split measured before the finer parts existed", () => {
  const old = { system: 100, tools: 100, history: 700, input: 100 };

  it("still draws its four rows, with the missing parts counting as nothing", () => {
    const rows = breakdownRows(old);
    expect(rows.map((row) => row.key)).toEqual(["system", "tools", "history", "input"]);
    expect(rows.reduce((total, row) => total + row.ratio, 0)).toBeCloseTo(1);
  });

  it("still scales to the tokens the server reported", () => {
    const split = splitContext(old, 1000);
    expect(split).toMatchObject({ system: 100, tools: 100, history: 700, input: 100 });
  });
});
