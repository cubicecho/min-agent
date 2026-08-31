import { type ScheduledTask, schedule, validate } from "node-cron";
import type { CronJob, CronJobState, TokenUsage } from "../shared/types.ts";
import { runTurn } from "./agent.ts";
import { loadCronJobs } from "./config.ts";
import { forgetJobs, listRuns, recordRun } from "./runs.ts";
import { createSession, saveSession } from "./store.ts";

interface Entry {
  job: CronJob;
  task?: ScheduledTask;
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastError?: string;
  lastSessionId?: string;
}

const entries = new Map<string, Entry>();

export const isValidSchedule = (expression: string) => validate(expression);

/** A firing job opens a fresh session, so every run reads back like any other chat. */
export async function runJob(job: CronJob): Promise<string> {
  const entry: Entry = entries.get(job.id) ?? { job };
  entries.set(job.id, entry);

  const session = createSession({
    title: `${job.name} — ${new Date().toLocaleString()}`,
    source: "cron",
    cronJobId: job.id,
    model: job.model || undefined,
  });

  const startedAt = new Date().toISOString();
  entry.lastRunAt = startedAt;
  entry.lastSessionId = session.id;

  let usage: TokenUsage | undefined;
  try {
    const stats = await runTurn({ session, prompt: job.prompt, model: job.model || undefined });
    // The run log only wants the token counts, not the whole timing record.
    usage = {
      promptTokens: stats.promptTokens,
      completionTokens: stats.completionTokens,
      totalTokens: stats.totalTokens,
    };
    entry.lastStatus = "ok";
    entry.lastError = undefined;
  } catch (error) {
    entry.lastStatus = "error";
    entry.lastError = error instanceof Error ? error.message : String(error);
    session.title = `${session.title} (failed)`;
    saveSession(session);
    console.error(`[cron] ${job.id}: ${entry.lastError}`);
  }

  recordRun({
    jobId: job.id,
    startedAt,
    finishedAt: new Date().toISOString(),
    status: entry.lastStatus === "error" ? "error" : "ok",
    error: entry.lastError,
    sessionId: session.id,
    usage: usage?.totalTokens ? usage : undefined,
  });
  return session.id;
}

/** Rebuild every scheduled task from the config file. */
export function sync(jobs: CronJob[] = loadCronJobs()) {
  for (const [id, entry] of entries) {
    if (!jobs.some((job) => job.id === id)) {
      void entry.task?.destroy();
      entries.delete(id);
    }
  }

  forgetJobs(jobs.map((job) => job.id));

  for (const job of jobs) {
    const existing = entries.get(job.id);
    void existing?.task?.destroy();
    const entry: Entry = { ...existing, job, task: undefined };
    entries.set(job.id, entry);

    if (!job.enabled) continue;
    if (!validate(job.schedule)) {
      entry.lastStatus = "error";
      entry.lastError = `invalid cron expression: ${job.schedule}`;
      console.error(`[cron] ${job.id}: ${entry.lastError}`);
      continue;
    }
    entry.task = schedule(job.schedule, () => runJob(job), {
      name: job.id,
      noOverlap: true,
      ...(job.timezone ? { timezone: job.timezone } : {}),
    });
  }
}

/** In-memory state wins; the run log fills in what a restart forgot. */
export function state(): CronJobState[] {
  return [...entries.values()].map((entry) => {
    const last = entry.lastRunAt ? undefined : listRuns(entry.job.id)[0];
    return {
      job: entry.job,
      nextRun: entry.task?.getNextRun()?.toISOString(),
      lastRunAt: entry.lastRunAt ?? last?.startedAt,
      lastStatus: entry.lastStatus ?? last?.status,
      lastError: entry.lastError ?? last?.error,
      lastSessionId: entry.lastSessionId ?? last?.sessionId,
    };
  });
}
