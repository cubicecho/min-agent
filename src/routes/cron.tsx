import { formatUsage } from "@shared/client/usage.ts";
import type { CronJob, CronJobState, CronRun, ModelInfo } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { CircleAlert, CircleCheck, Clock, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const DEFAULT_MODEL = "__default__";

const when = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "—");

const blank = (): CronJob => ({
  id: "",
  name: "",
  schedule: "0 9 * * *",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  enabled: false,
  model: "",
  prompt: "",
});

/** Turns a name into a usable id so the id field is one less thing to fill in. */
const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export function CronRoute() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const crons = useQuery({ queryKey: ["crons"], queryFn: api.crons, refetchInterval: 15000 });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  /** `null` = dialog closed. A job with an empty id = creating a new one. */
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [confirming, setConfirming] = useState<CronJob | null>(null);

  const jobs = (crons.data ?? []).map((state) => state.job);

  const save = useMutation({
    mutationFn: (next: CronJob[]) => api.saveCrons(next),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["crons"] });
      toast.success("Saved to config/crons.yaml");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const run = useMutation({
    mutationFn: api.runCron,
    onSuccess: async ({ sessionId }) => {
      await queryClient.invalidateQueries({ queryKey: ["crons"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      navigate({ to: "/chats/$sessionId", params: { sessionId } });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  function commit(job: CronJob, original: CronJob) {
    const exists = jobs.some((item) => item.id === original.id);
    save.mutate(
      exists ? jobs.map((item) => (item.id === original.id ? job : item)) : [...jobs, job],
    );
  }

  function remove(job: CronJob) {
    setConfirming(null);
    save.mutate(jobs.filter((item) => item.id !== job.id));
  }

  return (
    <Page
      title="Cron"
      description="Each run opens its own chat session, so you can read back exactly what happened."
      actions={
        <Button onClick={() => setEditing(blank())}>
          <Plus className="size-4" />
          New job
        </Button>
      }
    >
      {crons.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No jobs yet. Add one, or edit <code>config/crons.yaml</code> directly.
        </p>
      ) : null}

      <div className="divide-y rounded-lg border">
        {(crons.data ?? []).map((state) => (
          <Row
            key={state.job.id}
            state={state}
            onEdit={() => setEditing(state.job)}
            onRun={() => run.mutate(state.job.id)}
            onDelete={() => setConfirming(state.job)}
            running={run.isPending && run.variables === state.job.id}
          />
        ))}
      </div>

      <ConfirmDelete job={confirming} onCancel={() => setConfirming(null)} onConfirm={remove} />

      <JobDialog
        job={editing}
        takenIds={jobs.map((item) => item.id)}
        models={models.data?.models ?? []}
        saving={save.isPending}
        onClose={() => setEditing(null)}
        onSave={commit}
      />
    </Page>
  );
}

function Row({
  state,
  onEdit,
  onRun,
  onDelete,
  running,
}: {
  state: CronJobState;
  onEdit: () => void;
  onRun: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const { job } = state;
  return (
    <div className="group flex items-center gap-3 px-3 py-2.5 hover:bg-accent/50">
      <button
        type="button"
        onClick={onEdit}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <Clock
          className={cn(
            "size-4 shrink-0",
            job.enabled ? "text-emerald-500" : "text-muted-foreground",
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">{job.name || job.id}</span>
            {!job.enabled ? (
              <Badge variant="secondary" className="font-normal">
                paused
              </Badge>
            ) : null}
            {state.lastStatus === "error" ? (
              <Badge className="bg-destructive/15 font-normal text-destructive">
                last run failed
              </Badge>
            ) : null}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            <code>{job.schedule}</code>
            {job.enabled ? ` · next ${when(state.nextRun)}` : ""}
            {state.lastRunAt ? ` · last ${when(state.lastRunAt)}` : ""}
          </div>
          {state.lastSummary ? (
            <p className="mt-1 truncate text-xs text-foreground/80">{state.lastSummary}</p>
          ) : null}
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-1">
        <Button variant="ghost" size="icon" aria-label="Run now" onClick={onRun} disabled={running}>
          <Play className={cn("size-4", running && "animate-pulse")} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${job.name || job.id}`}
          onClick={onDelete}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  );
}

function ConfirmDelete({
  job,
  onCancel,
  onConfirm,
}: {
  job: CronJob | null;
  onCancel: () => void;
  onConfirm: (job: CronJob) => void;
}) {
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete "{job?.name || job?.id}"?</DialogTitle>
          <DialogDescription>
            The job and its run history are removed. The chat sessions it produced are kept.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => job && onConfirm(job)}>
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** One form for both create and edit; `job.id === ""` means it is a new job. */
function JobDialog({
  job,
  takenIds,
  models,
  saving,
  onClose,
  onSave,
}: {
  job: CronJob | null;
  takenIds: string[];
  models: ModelInfo[];
  saving: boolean;
  onClose: () => void;
  onSave: (job: CronJob, original: CronJob) => void;
}) {
  return (
    <Dialog open={Boolean(job)} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        {job ? (
          <JobForm
            key={job.id || "__new__"}
            job={job}
            takenIds={takenIds}
            models={models}
            saving={saving}
            onCancel={onClose}
            onSave={onSave}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function JobForm({
  job,
  takenIds,
  models,
  saving,
  onCancel,
  onSave,
}: {
  job: CronJob;
  takenIds: string[];
  models: ModelInfo[];
  saving: boolean;
  onCancel: () => void;
  onSave: (job: CronJob, original: CronJob) => void;
}) {
  const isNew = job.id === "";
  const [draft, setDraft] = useState<CronJob>(job);
  const set = <K extends keyof CronJob>(key: K, value: CronJob[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const id = isNew ? slug(draft.name) : draft.id;
  const duplicate = isNew && id !== "" && takenIds.includes(id);
  const problem = !draft.name.trim()
    ? "Name is required."
    : !id
      ? "Name must contain a letter or digit."
      : duplicate
        ? `A job called "${id}" already exists.`
        : !draft.schedule.trim()
          ? "Schedule is required."
          : !draft.prompt.trim()
            ? "Prompt is required."
            : null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "New job" : draft.name || draft.id}</DialogTitle>
        <DialogDescription>
          A 5-field cron expression, plus the prompt to send when it fires.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="job-name">Name</Label>
            <Input
              id="job-name"
              value={draft.name}
              onChange={(event) => set("name", event.target.value)}
              placeholder="Morning brief"
            />
            <p className="text-xs text-muted-foreground">
              {isNew ? (
                <>
                  id: <code>{id || "—"}</code>
                </>
              ) : (
                <>
                  id: <code>{draft.id}</code> (fixed)
                </>
              )}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="job-schedule">Schedule</Label>
            <Input
              id="job-schedule"
              value={draft.schedule}
              onChange={(event) => set("schedule", event.target.value)}
              placeholder="0 9 * * *"
              className="font-mono"
            />
            <p className="text-xs text-muted-foreground">min hour day month weekday</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-2">
            <Label htmlFor="job-tz">Timezone</Label>
            <Input
              id="job-tz"
              value={draft.timezone}
              onChange={(event) => set("timezone", event.target.value)}
              placeholder="America/Chicago"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="job-model">Model</Label>
            <Select
              value={draft.model || DEFAULT_MODEL}
              onValueChange={(value) => set("model", value === DEFAULT_MODEL ? "" : value)}
            >
              <SelectTrigger id="job-model">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={DEFAULT_MODEL}>Default (from Config)</SelectItem>
                {models.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id}>
                    {entry.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="job-prompt">Prompt</Label>
          <Textarea
            id="job-prompt"
            value={draft.prompt}
            onChange={(event) => set("prompt", event.target.value)}
            rows={5}
            placeholder="Summarize yesterday's commits and flag anything that looks risky."
          />
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="job-enabled"
            checked={draft.enabled}
            onCheckedChange={(enabled) => set("enabled", enabled)}
          />
          <Label htmlFor="job-enabled">Enabled</Label>
        </div>

        {isNew ? null : <RunHistory jobId={job.id} />}
      </div>

      <DialogFooter className="items-center gap-2 sm:justify-between">
        <span className="text-xs text-destructive">{problem ?? ""}</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(problem) || saving}
            onClick={() => onSave({ ...draft, id }, job)}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** The last runs recorded in data/cron-runs.json, newest first. */
function RunHistory({ jobId }: { jobId: string }) {
  const runs = useQuery({ queryKey: ["cron-runs", jobId], queryFn: () => api.cronRuns(jobId) });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });

  return (
    <div className="flex flex-col gap-2">
      <Label>Recent runs</Label>
      {runs.data?.length ? (
        <div className="divide-y rounded-md border text-xs">
          {runs.data.map((run) => (
            <RunRow key={run.startedAt} run={run} pricing={config.data?.pricing} />
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {runs.isLoading ? "Loading…" : "This job has not run yet."}
        </p>
      )}
    </div>
  );
}

function RunRow({ run, pricing }: { run: CronRun; pricing?: CronPricing }) {
  const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;
  return (
    <div className="flex items-start gap-2 px-2.5 py-2">
      {run.status === "ok" ? (
        <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
      ) : (
        <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
          <span className="text-foreground">{when(run.startedAt)}</span>
          <span>{seconds.toFixed(1)}s</span>
          {run.usage ? <span>{formatUsage(run.usage, pricing)}</span> : null}
        </div>
        {run.summary ? <p className="mt-0.5 text-foreground/80">{run.summary}</p> : null}
        {run.error ? <p className="mt-0.5 break-words text-destructive">{run.error}</p> : null}
      </div>
      <Link
        to="/chats/$sessionId"
        params={{ sessionId: run.sessionId }}
        className="shrink-0 underline underline-offset-2 hover:text-foreground"
      >
        open
      </Link>
    </div>
  );
}

type CronPricing = NonNullable<Parameters<typeof formatUsage>[1]>;
