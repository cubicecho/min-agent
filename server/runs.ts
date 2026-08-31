import fs from "node:fs";
import path from "node:path";
import type { CronRun } from "../shared/types.ts";
import { DATA_DIR } from "./paths.ts";

const FILE = path.join(DATA_DIR, "cron-runs.json");

/** Kept per job, so one chatty job can never bury the others. */
const KEEP_PER_JOB = 20;

type Log = Record<string, CronRun[]>;

function read(): Log {
  try {
    const parsed = JSON.parse(fs.readFileSync(FILE, "utf8")) as Log;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function write(log: Log) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(log, null, 2), "utf8");
}

/** Newest first. */
export function listRuns(jobId: string): CronRun[] {
  return read()[jobId] ?? [];
}

export function recordRun(run: CronRun) {
  const log = read();
  log[run.jobId] = [run, ...(log[run.jobId] ?? [])].slice(0, KEEP_PER_JOB);
  write(log);
}

/** Called when a job is deleted from crons.yaml, so the log does not grow forever. */
export function forgetJobs(keep: string[]) {
  const log = read();
  let changed = false;
  for (const id of Object.keys(log)) {
    if (!keep.includes(id)) {
      delete log[id];
      changed = true;
    }
  }
  if (changed) write(log);
}
