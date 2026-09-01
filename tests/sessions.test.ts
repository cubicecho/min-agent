import { describe, expect, it } from "vitest";
import { bucketOf, groupSessions, matchSessions } from "../shared/client/sessions.ts";

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

/**
 * A fixed "now" at midday, so the buckets are measured against a known set of midnights
 * rather than against whatever time the suite happens to run at.
 */
const now = new Date("2025-11-12T12:00:00").getTime();
const at = (iso: string) => new Date(iso).toISOString();

describe("bucketOf", () => {
  it("counts calendar days, not elapsed hours", () => {
    expect(bucketOf(at("2025-11-12T00:05:00"), now)).toBe("today");
    expect(bucketOf(at("2025-11-11T23:55:00"), now)).toBe("yesterday");
  });

  it("puts the rest of the last week together, and everything older under one heading", () => {
    expect(bucketOf(at("2025-11-10T09:00:00"), now)).toBe("week");
    expect(bucketOf(at("2025-11-06T09:00:00"), now)).toBe("week");
    expect(bucketOf(at("2025-11-05T09:00:00"), now)).toBe("earlier");
    expect(bucketOf(at("2024-01-01T09:00:00"), now)).toBe("earlier");
  });

  it("treats a clock that is ahead as today rather than inventing a bucket", () => {
    expect(bucketOf(at("2025-11-13T09:00:00"), now)).toBe("today");
  });
});

describe("groupSessions", () => {
  const chats = [
    { title: "a", updatedAt: at("2025-11-12T11:00:00") },
    { title: "b", updatedAt: at("2025-11-12T08:00:00") },
    { title: "c", updatedAt: at("2025-11-11T08:00:00") },
    { title: "d", updatedAt: at("2025-10-01T08:00:00") },
  ];

  it("keeps the order it was handed within a group", () => {
    expect(groupSessions(chats, now)).toEqual([
      { bucket: "today", label: "Today", sessions: [chats[0], chats[1]] },
      { bucket: "yesterday", label: "Yesterday", sessions: [chats[2]] },
      { bucket: "earlier", label: "Earlier", sessions: [chats[3]] },
    ]);
  });

  it("drops a group with nothing in it, and holds the headings in one order", () => {
    const groups = groupSessions([chats[3], chats[0]], now);
    expect(groups.map((group) => group.bucket)).toEqual(["today", "earlier"]);
  });

  it("has nothing to say about an empty list", () => {
    expect(groupSessions([], now)).toEqual([]);
  });
});
