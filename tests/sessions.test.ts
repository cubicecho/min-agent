import { describe, expect, it } from "vitest";
import { matchSessions } from "../shared/client/sessions.ts";

const list = [
  { title: "CI for the Docker image" },
  { title: "Docker compose for the server" },
  { title: "Why is the sidebar slow?" },
];

describe("matchSessions", () => {
  it("returns everything for an empty query", () => {
    expect(matchSessions(list, "")).toEqual(list);
    expect(matchSessions(list, "   ")).toEqual(list);
  });

  it("ignores case", () => {
    expect(matchSessions(list, "SIDEBAR")).toEqual([list[2]]);
  });

  it("requires every term, in any order", () => {
    expect(matchSessions(list, "docker ci")).toEqual([list[0]]);
    expect(matchSessions(list, "ci docker")).toEqual([list[0]]);
    expect(matchSessions(list, "docker")).toEqual([list[0], list[1]]);
  });

  it("returns nothing when a term matches no title", () => {
    expect(matchSessions(list, "docker kubernetes")).toEqual([]);
  });
});
