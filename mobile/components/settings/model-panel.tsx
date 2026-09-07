import { MODEL_TASKS } from "@shared/model-tasks.ts";
import { Text, View } from "react-native";
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
  NumberInput,
  Select,
} from "@/components/ui.tsx";
import { ConfigForm } from "./config-form.tsx";

/** Select needs a non-empty value, so "unset" gets a sentinel that never reaches the config. */
const NO_TASK_MODEL = "__none__";

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
    <ConfigForm tab="model">
      {({
        draft,
        view,
        set,
        modelOptions,
        models,
        endpointPending,
        applyEndpoint,
        endpointBusy,
        probe,
      }) => (
        <>
          <Card>
            <CardTitle>Endpoint</CardTitle>
            <CardDescription>
              An OpenAI-compatible server. The model list below is fetched by the agent from this
              address, so it has to be stored before there is anything to pick from — which is what
              the button does. Settings are stored in Postgres.
            </CardDescription>

            <Field
              label="Base URL"
              hint="Ollama :11434/v1, LM Studio :1234/v1, OpenAI https://api.openai.com/v1."
            >
              <Input
                value={draft.baseUrl}
                onChangeText={(value) => set("baseUrl", value)}
                onSubmitEditing={applyEndpoint}
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
                onSubmitEditing={applyEndpoint}
                secureTextEntry
                autoCapitalize="none"
                placeholder={view.hasApiKey ? "•••••••• (leave blank to keep)" : "optional"}
              />
            </Field>

            {/* Its own button, and not the Save bar's job, because these two fields are the
                only ones on the settings screen that something else on the screen depends on:
                the pickers below are filled in by asking the provider, and the agent asks the
                one it has stored. Pressing this stores just these two and asks again. */}
            <View className="flex-row items-center gap-2">
              <Button icon="check" busy={endpointBusy} onPress={applyEndpoint}>
                {endpointPending ? "Apply and load models" : "Reload models"}
              </Button>
              {endpointPending ? (
                <Muted className="flex-1">Not applied yet — the list below is the old one.</Muted>
              ) : null}
            </View>

            {probe && (
              <View className="flex-row items-center gap-2">
                <Badge variant={probe.ok ? "secondary" : "destructive"}>
                  {probe.ok ? "Connected" : "Failed"}
                </Badge>
                <Text className="flex-1 text-xs text-muted-foreground">{probe.detail}</Text>
              </View>
            )}
          </Card>

          <Card>
            <CardTitle>Models</CardTitle>

            <Field
              label="Default model"
              hint={
                models.error
                  ? undefined
                  : `${models.count} model(s) reported by the saved endpoint.`
              }
            >
              <Select
                value={draft.model}
                options={modelOptions}
                disabled={endpointPending}
                onChange={(value) => set("model", value)}
                placeholder={
                  endpointPending
                    ? "apply the endpoint first"
                    : models.error
                      ? "server unreachable"
                      : "select a model"
                }
              />
            </Field>
            {models.error && !endpointPending ? <ErrorNote error={models.error} /> : null}

            <View className="gap-1">
              <Text className="text-sm font-medium text-foreground">Task models</Text>
              <Muted>
                Side jobs that need not run on the chat model. Each is short and frequent, so a
                small fast model usually serves them better.
              </Muted>
            </View>

            {MODEL_TASKS.map((task) => (
              <Field key={task.key} label={task.label} hint={task.hint}>
                <Select
                  value={draft.taskModels[task.key] || NO_TASK_MODEL}
                  options={[{ label: task.empty, value: NO_TASK_MODEL }, ...modelOptions]}
                  disabled={endpointPending}
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
            <CardTitle>Pricing</CardTitle>
            <CardDescription>
              Only used to turn the token counts into a cost. Leave both at 0 — the default for a
              local model — and min-agent shows tokens alone.
            </CardDescription>
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Input $ / 1M">
                  <NumberInput
                    value={draft.pricing.inputPer1M}
                    onChangeValue={(value) =>
                      set("pricing", { ...draft.pricing, inputPer1M: value })
                    }
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Output $ / 1M">
                  <NumberInput
                    value={draft.pricing.outputPer1M}
                    onChangeValue={(value) =>
                      set("pricing", { ...draft.pricing, outputPer1M: value })
                    }
                  />
                </Field>
              </View>
            </View>
          </Card>
        </>
      )}
    </ConfigForm>
  );
}
