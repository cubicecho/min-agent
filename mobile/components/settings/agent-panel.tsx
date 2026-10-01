import { REASONING_EFFORTS, type ReasoningEffort } from "@shared/types.ts";
import { useMutation } from "@tanstack/react-query";
import { View } from "react-native";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  ErrorNote,
  Field,
  Muted,
  NumberInput,
  Select,
  Textarea,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { useCopy } from "@/lib/copy.ts";
import type { Draft } from "./config-form.tsx";
import { ConfigForm } from "./config-form.tsx";

/**
 * The reasoning menu, in the order `REASONING_EFFORTS` gives it.
 *
 * Only the two at the top are spelled out. The rest are a ladder and read as one, and a label
 * explaining what "medium" means beside "low" and "high" would be saying it twice.
 */
const EFFORT_LABEL: Record<ReasoningEffort, string> = {
  off: "Off — send no reasoning setting at all",
  none: "None — tell a reasoning model not to think",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra high",
  max: "Max",
};

const EFFORT_OPTIONS = REASONING_EFFORTS.map((effort) => ({
  label: EFFORT_LABEL[effort],
  value: effort,
}));

/**
 * Copies the saved settings out as an agent spec.
 *
 * The document is built by the server from the stored row, so it is fetched when the button is
 * pressed rather than when the panel opens: there is nothing to show until then, and a copy
 * taken a minute after the panel loaded should not be a minute old. For the same reason the
 * button is off while anything is unsaved — what would be copied is the row, not the form, and
 * a button that quietly copied the settings from before your edits would be the wrong one to
 * trust.
 *
 * Fetching first means the write is no longer inside the press by the time it happens, and a
 * browser that only lends the clipboard to a gesture refuses it. That is said as an error: the
 * other copy buttons can stay quiet about a refusal because they have nothing to wait for.
 * @param props.dirty Something on Model, Agent or Voice is unsaved; the three share one row.
 * @returns The button, its hint, and the error if the fetch or the copy failed.
 */
function CopySpec({ dirty }: { dirty: boolean }) {
  const { copied, copy } = useCopy();
  const fetched = useMutation({
    mutationFn: async () => {
      const ok = await copy(JSON.stringify(await api.spec(), null, 2));
      if (!ok) throw new Error("The clipboard refused the copy.");
    },
  });

  return (
    <>
      <View className="flex-row items-center gap-2">
        <Button
          variant="outline"
          icon={copied ? "check" : "copy"}
          busy={fetched.isPending}
          disabled={dirty}
          accessibilityLabel={copied ? "Copied" : "Copy agent spec"}
          onPress={() => fetched.mutate()}
        >
          Copy agent spec
        </Button>
        {dirty ? <Muted className="flex-1">Save to copy the current settings.</Muted> : null}
      </View>
      <Muted>The API key is never included.</Muted>
      <ErrorNote error={fetched.error} />
    </>
  );
}

/**
 * How the agent runs a turn: how long it may be, how hard it may work, and what it is told.
 *
 * The provider and its models are next door under Model, and the voice settings under Voice.
 * What is left here is the part that is about the loop itself, which is the one group on the
 * old panel that had no other home.
 */
export function AgentPanel() {
  return (
    <ConfigForm tab="agent">
      {({ draft, set, dirty }) => (
        <>
          <Card>
            <CardTitle>Limits</CardTitle>
            <CardDescription>
              What one turn is allowed to spend. The context window is the whole conversation, and
              the reply limit is only the answer at the end of it.
            </CardDescription>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field
                  label="Max reply tokens"
                  hint="The longest single reply. Not the context window."
                >
                  <NumberInput
                    integer
                    value={draft.maxTokens}
                    onChangeValue={(value) => set("maxTokens", value)}
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Temperature" hint="Higher is more random. 0 is deterministic.">
                  <NumberInput
                    value={draft.temperature}
                    onChangeValue={(value) => set("temperature", value)}
                  />
                </Field>
              </View>
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Max tool loops" hint="How many tool calls one turn may make.">
                  <NumberInput
                    integer
                    value={draft.maxToolIterations}
                    onChangeValue={(value) => set("maxToolIterations", value)}
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Context window" hint="The whole conversation. 0 asks the server.">
                  <NumberInput
                    integer
                    value={draft.contextLimit}
                    onChangeValue={(value) => set("contextLimit", value)}
                  />
                </Field>
              </View>
            </View>

            <Field
              label="Reasoning effort"
              hint="Only a reasoning model takes this. Off and None are not the same: Off leaves the setting off the request, which is the only thing a server that has never heard of reasoning will accept, and None sends it — the way a model that can reason is told not to on this turn. A model that refuses the setting is asked again without it, so a wrong pick here costs a round trip rather than the turn."
            >
              <Select
                value={draft.reasoningEffort}
                options={EFFORT_OPTIONS}
                onChange={(value) => set("reasoningEffort", value as ReasoningEffort)}
              />
            </Field>
          </Card>

          <Card>
            <CardTitle>Tools</CardTitle>

            <Field
              label="MCP tools"
              hint="On demand puts a name-only catalogue in the system prompt and lets the model pull in the schemas it needs mid-turn. Much cheaper with many tools; costs one extra round trip on the turns that use them. Proxied does the same without changing the tool list, so a load keeps the server's prompt cache; the model calls each tool through one fixed tool, which smaller models get wrong more often."
            >
              <Select
                value={draft.toolDiscovery}
                options={[
                  { label: "On demand — load definitions as needed", value: "ondemand" },
                  {
                    label: "Proxied — load as needed, call through one tool, keep the cache",
                    value: "proxy",
                  },
                  { label: "Eager — send every definition every time", value: "eager" },
                ]}
                onChange={(value) => set("toolDiscovery", value as Draft["toolDiscovery"])}
              />
            </Field>
          </Card>

          <Card>
            <CardTitle>System prompt</CardTitle>
            <CardDescription>
              Sent at the head of every turn, before the conversation.
            </CardDescription>
            <Textarea
              value={draft.systemPrompt}
              onChangeText={(value) => set("systemPrompt", value)}
              className="min-h-36"
            />
          </Card>

          <Card>
            <CardTitle>Agent spec</CardTitle>
            <CardDescription>
              These settings as one JSON document, in the format other apps built on agent-core
              read. It covers Model and Voice as well as this panel.
            </CardDescription>
            <CopySpec dirty={dirty} />
          </Card>
        </>
      )}
    </ConfigForm>
  );
}
