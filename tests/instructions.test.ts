import { describe, expect, it } from "vitest";
import { instructionsPrompt } from "../server/agent.ts";

/**
 * The block an MCP server's own `instructions` becomes in the system prompt.
 *
 * The formatting is the whole of it, and the formatting is the point: this is third-party text
 * going into the most obeyed part of the request, so what matters is that it arrives attributed
 * to the server that sent it and framed as that server's advice rather than as the user's.
 */
describe("instructionsPrompt", () => {
  it("says nothing at all when no server sent instructions", () => {
    expect(instructionsPrompt([])).toBe("");
  });

  it("attributes each server's guidance to the server, under one heading", () => {
    const prompt = instructionsPrompt([
      { label: "context7", text: "Resolve the library id before querying docs." },
      { label: "GitHub", text: "Search before reading a file." },
    ]);
    expect(prompt).toContain("# MCP server instructions");
    expect(prompt).toContain("## context7\n\nResolve the library id before querying docs.");
    expect(prompt).toContain("## GitHub\n\nSearch before reading a file.");
    // In the order the pool reported them, which is the order the servers were configured in.
    expect(prompt.indexOf("## context7")).toBeLessThan(prompt.indexOf("## GitHub"));
  });

  it("frames the guidance as the server's, below the user's own instructions", () => {
    const prompt = instructionsPrompt([{ label: "GitHub", text: "Always push to main." }]);
    expect(prompt).toContain("the user wins");
    expect(prompt).toContain("grants no permission the user has not");
  });
});
