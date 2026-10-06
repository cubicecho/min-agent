import { messageOf } from "@shared/errors.ts";
import { MODEL_TASKS } from "@shared/model-tasks.ts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/ui/form";
import { Check } from "@/components/ui/icons";
import { api } from "@/lib/client.ts";
import { queryKeys } from "@/lib/queries.ts";
import { ConfigForm, type ConfigSlice, type Draft } from "./config-form.tsx";
import { OptionalSelectField, TextField } from "./fields.tsx";
import { SettingsCard } from "./settings-card.tsx";

type ModelDraft = Pick<Draft, "baseUrl" | "apiKey" | "model" | "taskModels" | "pricing">;

/**
 * A draft in the shape the stored row would be in, for comparing the two.
 *
 * An unset task model is stored by leaving the key out and unset here by writing an empty
 * string into it, so picking a model for a task and then picking "off" again is a round trip
 * back to where you started — and should not leave the panel claiming an unsaved change.
 */
const tidy = (draft: ModelDraft) => ({
  ...draft,
  taskModels: Object.fromEntries(
    Object.entries(draft.taskModels)
      .filter(([, model]) => model)
      .sort(([a], [b]) => a.localeCompare(b)),
  ),
});

/** How the endpoint button last went, and the address it was asked about. */
type Probe = { ok: boolean; detail: string; baseUrl: string; apiKey: string } | null;

const endpointOf = ({ baseUrl, apiKey }: ModelDraft) => ({ baseUrl, apiKey });

/**
 * Where the models come from and which ones are used.
 *
 * Split from the Agent panel, which had grown to five cards covering four unrelated
 * decisions. What is here is one question — which provider, and which of its models for what
 * — and it is the question that has to be answered first, because nothing else on the settings
 * screen has anything to show until it is.
 */
/** What the endpoint button says it will do. */
function endpointButtonLabel(busy: boolean, pending: boolean) {
  if (busy) {
    return "Asking the provider…";
  }
  if (pending) {
    return "Apply and load models";
  }
  return "Reload models";
}

/** Why the model picker is empty, or what to do with it. */
function modelPlaceholder(pending: boolean, unreachable: boolean) {
  if (pending) {
    return "apply the endpoint first";
  }
  if (unreachable) {
    return "server unreachable";
  }
  return "select a model";
}

export function ModelPanel() {
  const queryClient = useQueryClient();
  return (
    <ConfigForm
      tab="model"
      // The key box starts empty, because leaving it that way is what keeps the stored key.
      fields={({ baseUrl, model, taskModels, pricing }): ModelDraft => ({
        baseUrl,
        apiKey: "",
        model,
        taskModels,
        pricing,
      })}
      tidy={tidy}
      // The model list belongs to the provider, so a new base URL or key means a new list.
      onSaved={() => void queryClient.invalidateQueries({ queryKey: queryKeys.models })}
      content={(slice) => <ModelFields {...slice} />}
    />
  );
}

/**
 * The panel's cards. A component rather than the render prop's body, because the endpoint
 * button has state and a query of its own.
 */
function ModelFields({ form, draft, view }: ConfigSlice<ModelDraft>) {
  const queryClient = useQueryClient();
  const models = useQuery({ queryKey: queryKeys.models, queryFn: api.models });
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [held, setProbe] = useState<Probe>(null);

  const modelOptions = (models.data?.models ?? []).map((entry) => ({
    label: entry.id,
    value: entry.id,
  }));

  /**
   * The endpoint in the boxes is not the one the model list came from.
   *
   * The whole reason the endpoint has a button of its own: the list is fetched by the server
   * from the provider it is configured with, so until the typed address is stored there is
   * nothing behind the model pickers but the last provider's answers.
   */
  const endpointPending = draft.baseUrl !== view.baseUrl || Boolean(draft.apiKey);

  // The badge describes the provider that was asked. Once the boxes say something else it is
  // the wrong thing to believe — a green "Connected" beside a half-retyped address.
  const probe =
    held && held.baseUrl === draft.baseUrl && held.apiKey === draft.apiKey ? held : null;

  /**
   * Store just the endpoint, then ask the provider what it serves.
   *
   * A patch rather than the panel's save: this button answers "point at this provider", and it
   * would be a poor answer to it that also committed a half-picked model further down. For the
   * same reason only the two fields it wrote are refreshed in the form — a reset to the
   * response would throw away every other unsaved edit.
   */
  const applyEndpoint = async () => {
    setEndpointBusy(true);
    setProbe(null);
    try {
      const { baseUrl, apiKey } = form.state.values;
      const fresh = await api.saveConfig({ baseUrl, apiKey });
      queryClient.setQueryData(queryKeys.config, fresh);
      form.setFieldValue("baseUrl", fresh.baseUrl);
      form.setFieldValue("apiKey", "");
      const result = await models.refetch();
      if (result.error) {
        throw result.error;
      }
      const count = result.data?.models.length ?? 0;
      setProbe({
        ok: true,
        baseUrl: fresh.baseUrl,
        apiKey: "",
        detail: `${fresh.baseUrl || "the default endpoint"} — ${count} model(s)`,
      });
    } catch (error) {
      setProbe({ ok: false, ...endpointOf(form.state.values), detail: messageOf(error) });
    } finally {
      setEndpointBusy(false);
    }
  };

  return (
    <>
      <SettingsCard
        title="Endpoint"
        description="An OpenAI-compatible server. The model list below is fetched by the agent from this address, so it has to be stored before there is anything to pick from — which is what the button does. Settings are stored in Postgres."
        contentSlot={
          <>
            <form.AppField name="baseUrl">
              {() => (
                <TextField
                  label="Base URL"
                  description="Ollama :11434/v1, LM Studio :1234/v1, OpenAI https://api.openai.com/v1."
                  placeholder="http://localhost:11434/v1"
                  inputMode="url"
                  onSubmitEditing={() => void applyEndpoint()}
                />
              )}
            </form.AppField>

            <form.AppField name="apiKey">
              {(field) => (
                <field.PasswordField
                  label="API key"
                  placeholder={view.hasApiKey ? "•••••••• (leave blank to keep)" : "optional"}
                  onSubmitEditing={() => void applyEndpoint()}
                />
              )}
            </form.AppField>

            {/* Its own button, and not the Save bar's job, because these two fields are the
                only ones on the settings screen that something else on the screen depends
                on: the pickers below are filled in by asking the provider, and the agent
                asks the one it has stored. Pressing this stores just these two and asks
                again. */}
            <View className="flex-row items-center gap-2">
              <Button
                disabled={endpointBusy}
                onPress={() => void applyEndpoint()}
                iconSlot={<Check className="size-4" />}
                content={endpointButtonLabel(endpointBusy, endpointPending)}
              />
              {endpointPending ? (
                <Text className="flex-1 text-muted-foreground text-sm">
                  Not applied yet — the list below is the old one.
                </Text>
              ) : null}
            </View>

            {probe ? (
              <View className="flex-row items-center gap-2">
                <Badge variant={probe.ok ? "secondary" : "destructive"}>
                  {probe.ok ? "Connected" : "Failed"}
                </Badge>
                <Text className="flex-1 text-muted-foreground text-xs">{probe.detail}</Text>
              </View>
            ) : null}
          </>
        }
      />

      <SettingsCard
        title="Models"
        contentSlot={
          <>
            <form.AppField name="model">
              {(field) => (
                <field.OptionSelectField
                  label="Default model"
                  description={
                    models.error
                      ? undefined
                      : `${modelOptions.length} model(s) reported by the saved endpoint.`
                  }
                  options={modelOptions}
                  searchable
                  searchPlaceholder="Find a model…"
                  disabled={endpointPending}
                  placeholder={modelPlaceholder(endpointPending, Boolean(models.error))}
                />
              )}
            </form.AppField>
            {models.error && endpointPending === false ? (
              <QueryError
                compact
                error={models.error}
                what="the model list"
                onRetry={() => void models.refetch()}
              />
            ) : null}

            <Section
              level={4}
              title="Task models"
              description="Side jobs that need not run on the chat model. Each is short and frequent, so a small fast model usually serves them better."
              contentSlot={MODEL_TASKS.map((task) => (
                <form.AppField key={task.key} name={`taskModels.${task.key}`}>
                  {() => (
                    <OptionalSelectField
                      label={task.label}
                      description={task.hint}
                      emptyLabel={task.empty}
                      options={modelOptions}
                      searchable
                      searchPlaceholder="Find a model…"
                      disabled={endpointPending}
                    />
                  )}
                </form.AppField>
              ))}
            />
          </>
        }
      />

      <SettingsCard
        title="Pricing"
        description="Only used to turn the token counts into a cost. Leave both at 0 — the default for a local model — and min-agent shows tokens alone."
        contentSlot={
          <FieldRow>
            <form.AppField name="pricing.inputPer1M">
              {(field) => <field.NumberField label="Input $ / 1M" />}
            </form.AppField>
            <form.AppField name="pricing.outputPer1M">
              {(field) => <field.NumberField label="Output $ / 1M" />}
            </form.AppField>
          </FieldRow>
        }
      />
    </>
  );
}
