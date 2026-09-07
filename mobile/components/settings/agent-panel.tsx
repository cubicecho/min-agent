import { REASONING_EFFORTS, type ReasoningEffort } from "@shared/types.ts";
import { View } from "react-native";
import {
  Card,
  CardDescription,
  CardTitle,
  Field,
  NumberInput,
  Select,
  Textarea,
} from "@/components/ui.tsx";
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
 * How the agent runs a turn: how long it may be, how hard it may work, and what it is told.
 *
 * The provider and its models are next door under Model, and the voice settings under Voice.
 * What is left here is the part that is about the loop itself, which is the one group on the
 * old panel that had no other home.
 */
export function AgentPanel() {
  return (
    <ConfigForm tab="agent">
      {({ draft, set }) => (
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
        </>
      )}
    </ConfigForm>
  );
}
