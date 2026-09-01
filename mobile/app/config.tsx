import { MODEL_TASKS } from "@shared/model-tasks.ts";
import type { LlmConfigView } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  ErrorNote,
  Field,
  Input,
  Loading,
  Muted,
  Screen,
  Select,
  Separator,
  Textarea,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";

/** Select needs a non-empty value, so "unset" gets a sentinel that never reaches the config. */
const NO_TASK_MODEL = "__none__";

type Draft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  systemPrompt: string;
  pricing: { inputPer1M: number; outputPer1M: number };
  contextLimit: number;
  toolDiscovery: "eager" | "ondemand";
  taskModels: Record<string, string>;
};

/**
 * A form seeded from the stored row.
 *
 * `hasApiKey` is derived rather than a column, and a spread carries it in without TypeScript
 * noticing — excess-property checks do not apply to one, which is how it used to reach the
 * settings mutation and be rejected. The key box starts empty because leaving it that way is
 * what keeps the stored key.
 */
const seed = ({ hasApiKey: _, ...row }: LlmConfigView): Draft => ({ ...row, apiKey: "" });

/** Keeps a partly-typed number field usable — an empty box reads as 0, not NaN. */
const num = (value: string) => (value.trim() === "" ? 0 : (Number(value) ?? 0));

export default function ConfigScreen() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config.data && !draft) setDraft(seed(config.data));
  }, [config.data, draft]);

  const save = useMutation({
    mutationFn: (value: Draft) => api.saveConfig(value),
    onSuccess: async (fresh) => {
      setSaved(true);
      // Seeded from what the save read back, rather than cleared and left to a refetch.
      // Clearing it re-runs the effect above on the very next render — while the cache still
      // holds the pre-save row, because the refetch cannot have landed yet — so the form
      // filled itself back in with the values that had just been replaced and never looked
      // again. A successful save looked like one that had been ignored.
      queryClient.setQueryData(["config"], fresh);
      setDraft(seed(fresh));
      // The model list belongs to the provider, so a new base URL or key means a new list.
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  if (config.isError)
    return (
      <Screen>
        <ErrorNote error={config.error} />
      </Screen>
    );
  if (!draft) return <Loading />;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    // The note below the button describes the last save, and an edit outdates it.
    setSaved(false);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  const modelOptions = (models.data?.models ?? []).map((entry) => ({
    label: entry.id,
    value: entry.id,
  }));

  return (
    <Screen>
      <Card>
        <CardTitle>Connection</CardTitle>
        <CardDescription>
          An OpenAI-compatible server. Settings are stored in Postgres.
        </CardDescription>

        <Field
          label="Base URL"
          hint="Ollama :11434/v1, LM Studio :1234/v1, OpenAI https://api.openai.com/v1."
        >
          <Input
            value={draft.baseUrl}
            onChangeText={(value) => set("baseUrl", value)}
            placeholder="http://localhost:11434/v1"
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
          />
        </Field>

        <Field label="API key">
          <Input
            value={draft.apiKey}
            onChangeText={(value) => set("apiKey", value)}
            secureTextEntry
            autoCapitalize="none"
            placeholder={config.data?.hasApiKey ? "•••••••• (leave blank to keep)" : "optional"}
          />
        </Field>

        <Field
          label="Default model"
          hint={
            models.isError
              ? undefined
              : `${models.data?.models.length ?? 0} model(s) reported. Save the base URL first, then refresh.`
          }
        >
          <View className="flex-row gap-2">
            <View className="flex-1">
              <Select
                value={draft.model}
                options={modelOptions}
                onChange={(value) => set("model", value)}
                placeholder={models.isError ? "server unreachable" : "select a model"}
              />
            </View>
            <Button
              variant="outline"
              icon="refresh-cw"
              busy={models.isFetching}
              onPress={() => void models.refetch()}
            >
              Refresh
            </Button>
          </View>
        </Field>
        {models.isError && <ErrorNote error={models.error} />}

        <Separator />

        <View className="gap-1">
          <Text className="text-sm font-medium text-foreground">Task models</Text>
          <Muted>
            Side jobs that need not run on the chat model. Each is short and frequent, so a small
            fast model usually serves them better.
          </Muted>
        </View>

        {MODEL_TASKS.map((task) => (
          <Field key={task.key} label={task.label} hint={task.hint}>
            <Select
              value={draft.taskModels[task.key] || NO_TASK_MODEL}
              options={[{ label: task.empty, value: NO_TASK_MODEL }, ...modelOptions]}
              onChange={(value) =>
                set("taskModels", {
                  ...draft.taskModels,
                  [task.key]: value === NO_TASK_MODEL ? "" : value,
                })
              }
            />
          </Field>
        ))}
      </Card>

      <Card>
        <CardTitle>Agent</CardTitle>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Max tokens">
              <Input
                value={String(draft.maxTokens)}
                onChangeText={(value) => set("maxTokens", num(value))}
                keyboardType="number-pad"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Temperature">
              <Input
                value={String(draft.temperature)}
                onChangeText={(value) => set("temperature", num(value))}
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
        </View>

        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Max tool loops">
              <Input
                value={String(draft.maxToolIterations)}
                onChangeText={(value) => set("maxToolIterations", num(value))}
                keyboardType="number-pad"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Context window" hint="0 asks the server.">
              <Input
                value={String(draft.contextLimit)}
                onChangeText={(value) => set("contextLimit", num(value))}
                keyboardType="number-pad"
              />
            </Field>
          </View>
        </View>

        <Field
          label="MCP tools"
          hint="On demand puts a name-only catalogue in the system prompt and lets the model pull in the schemas it needs mid-turn. Much cheaper with many tools; costs one extra round trip on the turns that use them."
        >
          <Select
            value={draft.toolDiscovery}
            options={[
              { label: "On demand — load definitions as needed", value: "ondemand" },
              { label: "Eager — send every definition every time", value: "eager" },
            ]}
            onChange={(value) => set("toolDiscovery", value as Draft["toolDiscovery"])}
          />
        </Field>

        <Field label="System prompt">
          <Textarea
            value={draft.systemPrompt}
            onChangeText={(value) => set("systemPrompt", value)}
            className="min-h-36"
          />
        </Field>
      </Card>

      <Card>
        <CardTitle>Pricing</CardTitle>
        <CardDescription>
          Only used to turn the token counts into a cost. Leave both at 0 — the default for a local
          model — and min-agent shows tokens alone.
        </CardDescription>
        <View className="flex-row gap-3">
          <View className="flex-1">
            <Field label="Input $ / 1M">
              <Input
                value={String(draft.pricing.inputPer1M)}
                onChangeText={(value) =>
                  set("pricing", { ...draft.pricing, inputPer1M: num(value) })
                }
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
          <View className="flex-1">
            <Field label="Output $ / 1M">
              <Input
                value={String(draft.pricing.outputPer1M)}
                onChangeText={(value) =>
                  set("pricing", { ...draft.pricing, outputPer1M: num(value) })
                }
                keyboardType="decimal-pad"
              />
            </Field>
          </View>
        </View>
      </Card>

      <ErrorNote error={save.error} />
      <View className="flex-row items-center gap-3 pb-8">
        <Button icon="save" busy={save.isPending} onPress={() => save.mutate(draft)}>
          Save
        </Button>
        {saved && !save.isPending && <Muted>Saved</Muted>}
      </View>
    </Screen>
  );
}
