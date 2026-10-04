import { MODEL_TASKS } from "@shared/model-tasks.ts";
import { Text, View } from "react-native";
import { CardLayout } from "@/components/card-layout";
import { QueryError } from "@/components/query-state";
import { Section } from "@/components/section";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/ui/form";
import { Check } from "@/components/ui/icons";
import { ConfigForm } from "./config-form.tsx";
import { OptionalSelectField, TextField } from "./fields.tsx";

/**
 * Where the models come from and which ones are used.
 *
 * Split from the Agent panel, which had grown to five cards covering four unrelated
 * decisions. What is here is one question — which provider, and which of its models for what
 * — and it is the question that has to be answered first, because nothing else on the settings
 * screen has anything to show until it is.
 */
export function ModelPanel() {
  return (
    <ConfigForm
      tab="model"
      content={({
        form,
        view,
        modelOptions,
        models,
        endpointPending,
        applyEndpoint,
        endpointBusy,
        probe,
      }) => (
        <>
          <CardLayout
            title="Endpoint"
            description="An OpenAI-compatible server. The model list below is fetched by the agent from this address, so it has to be stored before there is anything to pick from — which is what the button does. Settings are stored in Postgres."
            contentClassName="flex flex-col gap-4"
            content={
              <>
                <form.AppField name="baseUrl">
                  {() => (
                    <TextField
                      label="Base URL"
                      description="Ollama :11434/v1, LM Studio :1234/v1, OpenAI https://api.openai.com/v1."
                      placeholder="http://localhost:11434/v1"
                      inputMode="url"
                      onSubmitEditing={applyEndpoint}
                    />
                  )}
                </form.AppField>

                <form.AppField name="apiKey">
                  {(field) => (
                    <field.PasswordField
                      label="API key"
                      placeholder={view.hasApiKey ? "•••••••• (leave blank to keep)" : "optional"}
                      onSubmitEditing={applyEndpoint}
                    />
                  )}
                </form.AppField>

                {/* Its own button, and not the Save bar's job, because these two fields are the
                    only ones on the settings screen that something else on the screen depends
                    on: the pickers below are filled in by asking the provider, and the agent
                    asks the one it has stored. Pressing this stores just these two and asks
                    again. */}
                <View className="flex-row items-center gap-2">
                  <Button disabled={endpointBusy} onPress={applyEndpoint}>
                    <Check className="size-4" />
                    {endpointBusy
                      ? "Asking the provider…"
                      : endpointPending
                        ? "Apply and load models"
                        : "Reload models"}
                  </Button>
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

          <CardLayout
            title="Models"
            contentClassName="flex flex-col gap-4"
            content={
              <>
                <form.AppField name="model">
                  {(field) => (
                    <field.OptionSelectField
                      label="Default model"
                      description={
                        models.error
                          ? undefined
                          : `${models.count} model(s) reported by the saved endpoint.`
                      }
                      options={modelOptions}
                      disabled={endpointPending}
                      placeholder={
                        endpointPending
                          ? "apply the endpoint first"
                          : models.error
                            ? "server unreachable"
                            : "select a model"
                      }
                    />
                  )}
                </form.AppField>
                {models.error && !endpointPending ? (
                  <QueryError
                    compact
                    error={models.error}
                    what="the model list"
                    onRetry={models.refetch}
                  />
                ) : null}

                <Section
                  level={4}
                  title="Task models"
                  description="Side jobs that need not run on the chat model. Each is short and frequent, so a small fast model usually serves them better."
                  contentClassName="flex flex-col gap-4"
                  content={MODEL_TASKS.map((task) => (
                    <form.AppField key={task.key} name={`taskModels.${task.key}`}>
                      {() => (
                        <OptionalSelectField
                          label={task.label}
                          description={task.hint}
                          emptyLabel={task.empty}
                          options={modelOptions}
                          disabled={endpointPending}
                        />
                      )}
                    </form.AppField>
                  ))}
                />
              </>
            }
          />

          <CardLayout
            title="Pricing"
            description="Only used to turn the token counts into a cost. Leave both at 0 — the default for a local model — and min-agent shows tokens alone."
            content={
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
      )}
    />
  );
}
