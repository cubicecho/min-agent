import { McpPoolError } from "@cubicecho/agent-mcp-pool";
import { describe, expect, it, vi } from "vitest";
import { callOnce } from "../server/agent.ts";

describe("callOnce", () => {
  it("makes an identical call once and replays its result with a note", async () => {
    const answered = new Map<string, Promise<string>>();
    const run = vi.fn(async () => "42");

    expect(await callOnce(answered, "k", run)).toBe("42");
    expect(await callOnce(answered, "k", run)).toMatch(/^42\n\n\(Identical call already made/);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("shares one call between identical calls in flight together", async () => {
    const answered = new Map<string, Promise<string>>();
    const run = vi.fn(async () => "ok");

    await Promise.all([callOnce(answered, "k", run), callOnce(answered, "k", run)]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps a tool's own rejection and replays it as the same failure", async () => {
    const answered = new Map<string, Promise<string>>();
    const run = vi.fn(async (): Promise<string> => {
      throw new McpPoolError("tool-error", "bad argument");
    });

    await expect(callOnce(answered, "k", run)).rejects.toThrow("bad argument");
    await expect(callOnce(answered, "k", run)).rejects.toThrow(
      /^bad argument\n\n\(Identical call already failed/,
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a pool refusal", new McpPoolError("backoff", "not connected")],
    ["a plain error, such as a timeout or an abort", new Error("Request timed out")],
  ])("forgets %s so the next call is a real retry", async (_, failure) => {
    const answered = new Map<string, Promise<string>>();
    const run = vi.fn().mockRejectedValueOnce(failure).mockResolvedValueOnce("ok");

    await expect(callOnce(answered, "k", run)).rejects.toThrow(failure.message);
    expect(await callOnce(answered, "k", run)).toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("passes a shared call's transient failure on without claiming it will repeat", async () => {
    const answered = new Map<string, Promise<string>>();
    const run = vi.fn(async (): Promise<string> => {
      throw new Error("Request timed out");
    });

    const results = await Promise.allSettled([
      callOnce(answered, "k", run),
      callOnce(answered, "k", run),
    ]);
    expect(results.map((result) => result.status === "rejected" && String(result.reason))).toEqual([
      "Error: Request timed out",
      "Error: Request timed out",
    ]);
  });
});
