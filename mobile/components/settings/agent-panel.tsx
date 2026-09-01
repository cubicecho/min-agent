import { MODEL_TASKS } from "@shared/model-tasks.ts";
import { type LlmConfigView, voiceBaseUrlFor } from "@shared/types.ts";
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
  Switch,
  Textarea,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { useReportDirty } from "./dirty.tsx";

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
  voiceBaseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  speakReplies: boolean;
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

/**
 * A draft in the shape the stored row would be in, for comparing the two.
 *
 * An unset task model is stored by leaving the key out and unset here by writing an empty
 * string into it, so picking a model for a task and then picking "off" again is a round trip
 * back to where you started — and should not leave the panel claiming an unsaved change.
 */
const tidy = (draft: Draft) => ({
  ...draft,
  taskModels: Object.fromEntries(
    Object.entries(draft.taskModels)
      .filter(([, model]) => model)
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
});

const same = (a: Draft, b: Draft) => JSON.stringify(tidy(a)) === JSON.stringify(tidy(b));

export function AgentPanel() {
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

  // The panel stays mounted behind the other tabs, so an unsaved form is only a tab away and
  // easy to walk off from. The comparison is against what is stored, not a flag set by
  // typing: putting a value back the way it was is not a change.
  const stored = config.data ? seed(config.data) : null;
  const dirty = Boolean(draft && stored && !same(draft, stored));
  useReportDirty("agent", dirty);

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

  const revert = () => {
    if (!stored) return;
    setSaved(false);
    setDraft(stored);
  };

  return (
    <View className="flex-1">
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
              <Field
                label="Max reply tokens"
                hint="The longest single reply. Not the context window."
              >
                <Input
                  value={String(draft.maxTokens)}
                  onChangeText={(value) => set("maxTokens", num(value))}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Temperature" hint="Higher is more random. 0 is deterministic.">
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
              <Field label="Max tool loops" hint="How many tool calls one turn may make.">
                <Input
                  value={String(draft.maxToolIterations)}
                  onChangeText={(value) => set("maxToolIterations", num(value))}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Context window" hint="The whole conversation. 0 asks the server.">
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
            Only used to turn the token counts into a cost. Leave both at 0 — the default for a
            local model — and min-agent shows tokens alone.
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

        <Card>
          <CardTitle>Voice</CardTitle>
          <CardDescription>
            Leave both models blank and voice runs on whatever the device already has: a browser
            reads replies aloud and takes dictation, an Android build reads replies aloud and leaves
            dictation to the microphone key on the keyboard. Naming a model moves that work to the
            server, which is the only way the desktop and Android builds get a microphone button of
            their own.
          </CardDescription>

          <Field
            label="Audio base URL"
            hint={`Where the transcription and speech endpoints are, when that is not where the chat model is — a local Ollama serves no audio. Blank uses ${voiceBaseUrlFor(draft) || "the base URL above"}. The same API key is sent either way.`}
          >
            <Input
              value={draft.voiceBaseUrl}
              onChangeText={(value) => set("voiceBaseUrl", value)}
              placeholder={draft.baseUrl || "https://api.openai.com/v1"}
              autoCapitalize="none"
              autoCorrect={false}
              inputMode="url"
            />
          </Field>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Speech to text" hint="whisper-1. Blank uses the device.">
                <Input
                  value={draft.sttModel}
                  onChangeText={(value) => set("sttModel", value)}
                  placeholder="off"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Text to speech" hint="tts-1. Blank uses the device.">
                <Input
                  value={draft.ttsModel}
                  onChangeText={(value) => set("ttsModel", value)}
                  placeholder="off"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </Field>
            </View>
          </View>

          <Field label="Voice" hint="Which voice the speech model uses. Blank takes its default.">
            <Input
              value={draft.ttsVoice}
              onChangeText={(value) => set("ttsVoice", value)}
              placeholder="alloy"
              autoCapitalize="none"
              autoCorrect={false}
            />
          </Field>

          <View className="flex-row items-center gap-3">
            <Switch
              value={draft.speakReplies}
              onValueChange={(value) => set("speakReplies", value)}
            />
            <Text className="text-sm text-foreground">Read every reply aloud</Text>
          </View>
        </Card>

        <View className="pb-8" />
      </Screen>

      {/*
        Pinned under the form rather than at the end of it. The form is three cards long and
        Save used to be past all of them, so the way to keep a change was to scroll back down
        past everything you had just read. It appears when there is something to do with it:
        a change to keep, or a save to confirm.
      */}
      {(dirty || saved || save.error) && (
        <View className="gap-2 border-t border-border bg-background p-3">
          <ErrorNote error={save.error} />
          <View className="flex-row items-center gap-3">
            <Muted className="flex-1">{dirty ? "Unsaved changes" : "Saved"}</Muted>
            {dirty && (
              <>
                <Button variant="outline" onPress={revert}>
                  Revert
                </Button>
                <Button icon="save" busy={save.isPending} onPress={() => save.mutate(draft)}>
                  Save
                </Button>
              </>
            )}
          </View>
        </View>
      )}
    </View>
  );
}
