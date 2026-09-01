import { describe, expect, it } from "vitest";
import { matchTerms } from "../shared/client/search.ts";

const list = ["qwen2.5-coder:7b", "llama3.2:3b", "qwen2.5:14b-instruct"];
const match = (query: string) => matchTerms(list, query, (item) => item);

describe("matchTerms", () => {
  it("returns everything for an empty query", () => {
    expect(match("")).toEqual(list);
    expect(match("   ")).toEqual(list);
  });

  it("ignores case", () => {
    expect(match("LLAMA")).toEqual([list[1]]);
  });

  it("requires every term, in any order", () => {
    expect(match("qwen coder")).toEqual([list[0]]);
    expect(match("coder qwen")).toEqual([list[0]]);
    expect(match("qwen")).toEqual([list[0], list[2]]);
  });

  it("returns nothing when a term matches nothing", () => {
    expect(match("qwen mistral")).toEqual([]);
  });

  it("reads the text off whatever shape it is given", () => {
    const options = [
      { label: "On demand", value: "ondemand" },
      { label: "Eager", value: "eager" },
    ];
    expect(matchTerms(options, "eager", (option) => option.label)).toEqual([options[1]]);
  });
});
