import { describe, expect, it } from "vitest";
import { carryOver } from "../server/agent.ts";

describe("carryOver", () => {
  it("keeps last turn's tools in place when one of them is used again", () => {
    expect(carryOver(["a", "b", "c"], ["a", "b", "c"], new Set(["a"]))).toEqual(["a", "b", "c"]);
  });

  it("appends what this turn loaded and called, in load order rather than call order", () => {
    expect(carryOver(["a"], ["a", "x", "y"], new Set(["y", "x"]))).toEqual(["a", "x", "y"]);
  });

  it("drops what this turn loaded and never called", () => {
    expect(carryOver(["a"], ["a", "guess", "x"], new Set(["x"]))).toEqual(["a", "x"]);
  });

  it("drops the oldest unused first once past the cap", () => {
    expect(carryOver(["a", "b", "c"], ["a", "b", "c", "d"], new Set(["a", "d"]), 3)).toEqual([
      "a",
      "c",
      "d",
    ]);
  });

  it("drops the oldest outright when everything carried was used", () => {
    expect(carryOver(["a", "b"], ["a", "b", "c"], new Set(["a", "b", "c"]), 2)).toEqual(["b", "c"]);
  });
});
