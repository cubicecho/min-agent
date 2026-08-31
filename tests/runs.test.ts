import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CronRun } from "@shared/types.ts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let dir: string;

const run = (jobId: string, startedAt: string, status: CronRun["status"] = "ok"): CronRun => ({
  jobId,
  startedAt,
  finishedAt: startedAt,
  status,
  sessionId: `session-${startedAt}`,
});

async function load() {
  vi.resetModules();
  process.env.MIN_AGENT_DATA_DIR = dir;
  return await import("../server/runs.ts");
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "min-agent-runs-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.MIN_AGENT_DATA_DIR;
});

describe("cron run log", () => {
  it("returns an empty list before anything has run", async () => {
    const runs = await load();
    expect(runs.listRuns("nightly")).toEqual([]);
  });

  it("keeps runs newest first, per job", async () => {
    const runs = await load();
    runs.recordRun(run("nightly", "2026-01-01T00:00:00.000Z"));
    runs.recordRun(run("weekly", "2026-01-02T00:00:00.000Z"));
    runs.recordRun(run("nightly", "2026-01-03T00:00:00.000Z", "error"));

    expect(runs.listRuns("nightly").map((item) => item.startedAt)).toEqual([
      "2026-01-03T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
    ]);
    expect(runs.listRuns("weekly")).toHaveLength(1);
  });

  it("caps the log at 20 runs per job", async () => {
    const runs = await load();
    for (let i = 0; i < 25; i++) {
      runs.recordRun(run("nightly", `2026-01-01T00:00:${String(i).padStart(2, "0")}.000Z`));
    }
    const kept = runs.listRuns("nightly");
    expect(kept).toHaveLength(20);
    expect(kept[0]?.startedAt).toBe("2026-01-01T00:00:24.000Z");
  });

  it("drops the log for jobs that no longer exist", async () => {
    const runs = await load();
    runs.recordRun(run("nightly", "2026-01-01T00:00:00.000Z"));
    runs.recordRun(run("weekly", "2026-01-01T00:00:00.000Z"));

    runs.forgetJobs(["weekly"]);

    expect(runs.listRuns("nightly")).toEqual([]);
    expect(runs.listRuns("weekly")).toHaveLength(1);
  });

  it("survives a corrupt log file", async () => {
    fs.writeFileSync(path.join(dir, "cron-runs.json"), "{not json", "utf8");
    const runs = await load();
    expect(runs.listRuns("nightly")).toEqual([]);
  });
});

describe("run summaries", () => {
  it("survives the round trip to disk, so history reads back after a restart", async () => {
    const { recordRun, listRuns } = await load();
    recordRun({ ...run("job", "2026-01-01T00:00:00Z"), summary: "Found 3 new invoices." });

    const reloaded = await load();
    expect(reloaded.listRuns("job")[0].summary).toBe("Found 3 new invoices.");
    expect(listRuns("job")[0].summary).toBe("Found 3 new invoices.");
  });

  it("leaves the field off when no model is set for the task", async () => {
    const { recordRun, listRuns } = await load();
    recordRun(run("job", "2026-01-01T00:00:00Z"));
    expect(listRuns("job")[0].summary).toBeUndefined();
  });
});
