import { Feather } from "@react-native-vector-icons/feather";
import { formatUsage } from "@shared/client/usage.ts";
import type { CronJob, CronJobState, CronRun, ModelInfo } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  ErrorNote,
  Field,
  Input,
  Muted,
  Screen,
  Select,
  Switch,
  Textarea,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { useColors } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";

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

export default function CronScreen() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const crons = useQuery({ queryKey: ["crons"], queryFn: api.crons, refetchInterval: 15000 });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });

  /** `null` = editor closed. A job with an empty id = creating a new one. */
  const [editing, setEditing] = useState<CronJob | null>(null);
  const [confirming, setConfirming] = useState<CronJob | null>(null);

  const jobs = (crons.data ?? []).map((state) => state.job);

  const save = useMutation({
    mutationFn: (next: CronJob[]) => api.saveCrons(next),
    onSuccess: async () => {
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ["crons"] });
    },
  });

  const run = useMutation({
    mutationFn: api.runCron,
    onSuccess: async ({ sessionId }) => {
      await queryClient.invalidateQueries({ queryKey: ["crons"] });
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      router.push(`/chat/${sessionId}`);
    },
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
    <Screen>
      <Muted>
        Each run opens its own chat session, so you can read back exactly what happened.
      </Muted>

      <ErrorNote error={crons.error ?? save.error ?? run.error} />

      {crons.data?.length === 0 && (
        <Card>
          <CardDescription>
            No jobs yet. Add one, or edit config/crons.yaml directly.
          </CardDescription>
        </Card>
      )}

      <View className="overflow-hidden rounded-xl border border-border">
        {(crons.data ?? []).map((state, index) => (
          <Row
            key={state.job.id}
            state={state}
            first={index === 0}
            onEdit={() => setEditing(state.job)}
            onRun={() => run.mutate(state.job.id)}
            onDelete={() => setConfirming(state.job)}
            running={run.isPending && run.variables === state.job.id}
          />
        ))}
      </View>

      <Button icon="plus" onPress={() => setEditing(blank())}>
        New job
      </Button>

      <ConfirmDelete job={confirming} onCancel={() => setConfirming(null)} onConfirm={remove} />

      <Modal
        visible={Boolean(editing)}
        animationType="slide"
        onRequestClose={() => setEditing(null)}
      >
        {editing ? (
          <JobForm
            key={editing.id || "__new__"}
            job={editing}
            takenIds={jobs.map((item) => item.id)}
            models={models.data?.models ?? []}
            saving={save.isPending}
            onCancel={() => setEditing(null)}
            onSave={commit}
          />
        ) : null}
      </Modal>
    </Screen>
  );
}

function Row({
  state,
  first,
  onEdit,
  onRun,
  onDelete,
  running,
}: {
  state: CronJobState;
  first: boolean;
  onEdit: () => void;
  onRun: () => void;
  onDelete: () => void;
  running: boolean;
}) {
  const colors = useColors();
  const { job } = state;

  return (
    <View className={cn("flex-row items-center gap-2 pr-1", !first && "border-t border-border")}>
      <Pressable
        onPress={onEdit}
        className="flex-1 flex-row items-center gap-3 px-3 py-2.5 active:bg-accent"
      >
        <Feather name="clock" size={15} color={job.enabled ? "#10b981" : colors.mutedForeground} />
        <View className="min-w-0 flex-1">
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-sm font-medium text-foreground" numberOfLines={1}>
              {job.name || job.id}
            </Text>
            {!job.enabled ? <Badge variant="secondary">paused</Badge> : null}
            {state.lastStatus === "error" ? <Badge variant="destructive">failed</Badge> : null}
          </View>
          <Muted>
            {job.schedule}
            {job.enabled ? ` · next ${when(state.nextRun)}` : ""}
            {state.lastRunAt ? ` · last ${when(state.lastRunAt)}` : ""}
          </Muted>
          {state.lastSummary ? (
            <Text className="mt-1 text-xs text-foreground/80" numberOfLines={2}>
              {state.lastSummary}
            </Text>
          ) : null}
        </View>
      </Pressable>

      <Button variant="ghost" size="icon" icon="play" busy={running} onPress={onRun} />
      <Button variant="ghost" size="icon" icon="trash-2" onPress={onDelete} />
    </View>
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
    <Modal visible={Boolean(job)} transparent animationType="fade" onRequestClose={onCancel}>
      <View className="flex-1 justify-center bg-black/50 p-6">
        <Card>
          <CardTitle>Delete "{job?.name || job?.id}"?</CardTitle>
          <CardDescription>
            The job and its run history are removed. The chat sessions it produced are kept.
          </CardDescription>
          <View className="flex-row justify-end gap-2">
            <Button variant="outline" onPress={onCancel}>
              Cancel
            </Button>
            <Button variant="destructive" onPress={() => job && onConfirm(job)}>
              Delete
            </Button>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

/** One form for both create and edit; `job.id === ""` means it is a new job. */
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
    <View className="flex-1 bg-background">
      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <View className="gap-1">
          <Text className="text-lg font-semibold text-foreground">
            {isNew ? "New job" : draft.name || draft.id}
          </Text>
          <Muted>A 5-field cron expression, plus the prompt to send when it fires.</Muted>
        </View>

        <Field label="Name" hint={isNew ? `id: ${id || "—"}` : `id: ${draft.id} (fixed)`}>
          <Input
            value={draft.name}
            onChangeText={(value) => set("name", value)}
            placeholder="Morning brief"
          />
        </Field>

        <Field label="Schedule" hint="min hour day month weekday">
          <Input
            value={draft.schedule}
            onChangeText={(value) => set("schedule", value)}
            placeholder="0 9 * * *"
            autoCapitalize="none"
            autoCorrect={false}
            className="font-mono"
          />
        </Field>

        <Field label="Timezone">
          <Input
            value={draft.timezone}
            onChangeText={(value) => set("timezone", value)}
            placeholder="America/Chicago"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </Field>

        <Field label="Model">
          <Select
            value={draft.model || DEFAULT_MODEL}
            options={[
              { label: "Default (from Config)", value: DEFAULT_MODEL },
              ...models.map((entry) => ({ label: entry.id, value: entry.id })),
            ]}
            onChange={(value) => set("model", value === DEFAULT_MODEL ? "" : value)}
          />
        </Field>

        <Field label="Prompt">
          <Textarea
            value={draft.prompt}
            onChangeText={(value) => set("prompt", value)}
            className="min-h-32"
            placeholder="Summarize yesterday's commits and flag anything that looks risky."
          />
        </Field>

        <View className="flex-row items-center gap-2">
          <Switch value={draft.enabled} onValueChange={(enabled) => set("enabled", enabled)} />
          <Text className="text-sm text-foreground">Enabled</Text>
        </View>

        {isNew ? null : <RunHistory jobId={job.id} />}
      </ScrollView>

      <View className="gap-2 border-t border-border p-4">
        {problem ? <Text className="text-xs text-destructive">{problem}</Text> : null}
        <View className="flex-row justify-end gap-2">
          <Button variant="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button
            disabled={Boolean(problem)}
            busy={saving}
            onPress={() => onSave({ ...draft, id }, job)}
          >
            {isNew ? "Create" : "Save"}
          </Button>
        </View>
      </View>
    </View>
  );
}

/** The last runs recorded in data/cron-runs.json, newest first. */
function RunHistory({ jobId }: { jobId: string }) {
  const runs = useQuery({ queryKey: ["cron-runs", jobId], queryFn: () => api.cronRuns(jobId) });
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });

  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-foreground">Recent runs</Text>
      {runs.data?.length ? (
        <View className="overflow-hidden rounded-lg border border-border">
          {runs.data.map((run, index) => (
            <RunRow
              key={run.startedAt}
              run={run}
              first={index === 0}
              pricing={config.data?.pricing}
            />
          ))}
        </View>
      ) : (
        <Muted>{runs.isLoading ? "Loading…" : "This job has not run yet."}</Muted>
      )}
    </View>
  );
}

function RunRow({ run, first, pricing }: { run: CronRun; first: boolean; pricing?: CronPricing }) {
  const router = useRouter();
  const seconds = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 1000;

  return (
    <View
      className={cn("flex-row items-start gap-2 px-2.5 py-2", !first && "border-t border-border")}
    >
      <Feather
        name={run.status === "ok" ? "check-circle" : "alert-circle"}
        size={13}
        color={run.status === "ok" ? "#10b981" : "#e7000b"}
        style={{ marginTop: 2 }}
      />
      <View className="min-w-0 flex-1">
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Text className="text-xs text-foreground">{when(run.startedAt)}</Text>
          <Muted>{seconds.toFixed(1)}s</Muted>
          {run.usage ? <Muted>{formatUsage(run.usage, pricing)}</Muted> : null}
        </View>
        {run.summary ? (
          <Text className="mt-0.5 text-xs text-foreground/80">{run.summary}</Text>
        ) : null}
        {run.error ? <Text className="mt-0.5 text-xs text-destructive">{run.error}</Text> : null}
      </View>
      <Pressable onPress={() => router.push(`/chat/${run.sessionId}`)}>
        <Text className="text-xs text-foreground underline">open</Text>
      </Pressable>
    </View>
  );
}

type CronPricing = NonNullable<Parameters<typeof formatUsage>[1]>;
