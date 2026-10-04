import { REASONING_EFFORTS, type ReasoningEffort } from "@shared/types.ts";
import { useMutation } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { FieldRow } from "@/components/ui/form";
import { Check, Copy } from "@/components/ui/icons";
import { api } from "@/lib/client.ts";
import { useCopy } from "@/lib/copy.ts";
import { ConfigForm } from "./config-form.tsx";
import { useAnyDirty } from "./dirty.tsx";
import { SettingsCard } from "./settings-card.tsx";

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

const DISCOVERY_OPTIONS = [
  { label: "On demand — load definitions as needed", value: "ondemand" },
  { label: "Proxied — load as needed, call through one tool, keep the cache", value: "proxy" },
  { label: "Eager — send every definition every time", value: "eager" },
];

/** The panels whose settings the spec is built from: an unsaved change on any of them is not in it. */
const SPEC_TABS = ["model", "agent", "voice"] as const;

/**
 * Copies the saved settings out as an agent spec.
 *
 * The document is built by the server from the stored row, so it is fetched when the button is
 * pressed rather than when the panel opens: there is nothing to show until then, and a copy
 * taken a minute after the panel loaded should not be a minute old. For the same reason the
 * button is off while anything is unsaved — what would be copied is the row, not the form, and
 * a button that quietly copied the settings from before your edits would be the wrong one to
 * trust. Any of the three panels counts, since the spec covers all of them.
 *
 * Fetching first means the write is no longer inside the press by the time it happens, and a
 * browser that only lends the clipboard to a gesture refuses it. That is said as an error: the
 * other copy buttons can stay quiet about a refusal because they have nothing to wait for.
 * @returns The button, its hint, and the error if the fetch or the copy failed.
 */
function CopySpec() {
  const dirty = useAnyDirty(SPEC_TABS);
  const { copied, copy } = useCopy();
  const fetched = useMutation({
    mutationFn: async () => {
      const ok = await copy(JSON.stringify(await api.spec(), null, 2));
      if (!ok) throw new Error("The clipboard refused the copy.");
    },
  });

  const Glyph = copied ? Check : Copy;

  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Button
          variant="outline"
          disabled={dirty || fetched.isPending}
          aria-label={copied ? "Copied" : "Copy agent spec"}
          onPress={() => fetched.mutate()}
        >
          <Glyph className="size-4" />
          {fetched.isPending ? "Copying…" : "Copy agent spec"}
        </Button>
        {dirty ? (
          <Text className="flex-1 text-muted-foreground text-sm">
            Save to copy the current settings.
          </Text>
        ) : null}
      </View>
      <Text className="text-muted-foreground text-sm">The API key is never included.</Text>
      {fetched.error ? (
        <Alert
          variant="destructive"
          title="Could not copy the spec"
          description={fetched.error.message}
        />
      ) : null}
    </View>
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
    <ConfigForm
      tab="agent"
      fields={({
        maxTokens,
        temperature,
        maxToolIterations,
        contextLimit,
        toolDiscovery,
        reasoningEffort,
        systemPrompt,
      }) => ({
        maxTokens,
        temperature,
        maxToolIterations,
        contextLimit,
        toolDiscovery,
        reasoningEffort,
        systemPrompt,
      })}
      content={({ form }) => (
        <>
          <SettingsCard
            title="Limits"
            description="What one turn is allowed to spend. The context window is the whole conversation, and the reply limit is only the answer at the end of it."
            content={
              <>
                <FieldRow>
                  <form.AppField name="maxTokens">
                    {(field) => (
                      <field.NumberField
                        integer
                        label="Max reply tokens"
                        description="The longest single reply. Not the context window."
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="temperature">
                    {(field) => (
                      <field.NumberField
                        label="Temperature"
                        description="Higher is more random. 0 is deterministic."
                      />
                    )}
                  </form.AppField>
                </FieldRow>

                <FieldRow>
                  <form.AppField name="maxToolIterations">
                    {(field) => (
                      <field.NumberField
                        integer
                        label="Max tool loops"
                        description="How many tool calls one turn may make."
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="contextLimit">
                    {(field) => (
                      <field.NumberField
                        integer
                        label="Context window"
                        description="The whole conversation. 0 asks the server."
                      />
                    )}
                  </form.AppField>
                </FieldRow>

                <form.AppField name="reasoningEffort">
                  {(field) => (
                    <field.OptionSelectField
                      label="Reasoning effort"
                      description="Only a reasoning model takes this. Off and None are not the same: Off leaves the setting off the request, which is the only thing a server that has never heard of reasoning will accept, and None sends it — the way a model that can reason is told not to on this turn. A model that refuses the setting is asked again without it, so a wrong pick here costs a round trip rather than the turn."
                      options={EFFORT_OPTIONS}
                    />
                  )}
                </form.AppField>
              </>
            }
          />

          <SettingsCard
            title="Tools"
            content={
              <form.AppField name="toolDiscovery">
                {(field) => (
                  <field.OptionSelectField
                    label="MCP tools"
                    description="On demand puts a name-only catalogue in the system prompt and lets the model pull in the schemas it needs mid-turn. Much cheaper with many tools; costs one extra round trip on the turns that use them. Proxied does the same without changing the tool list, so a load keeps the server's prompt cache; the model calls each tool through one fixed tool, which smaller models get wrong more often."
                    options={DISCOVERY_OPTIONS}
                  />
                )}
              </form.AppField>
            }
          />

          <SettingsCard
            title="System prompt"
            description="Sent at the head of every turn, before the conversation."
            content={
              <form.AppField name="systemPrompt">
                {(field) => <field.TextAreaField label="Prompt" className="min-h-36" />}
              </form.AppField>
            }
          />

          <SettingsCard
            title="Agent spec"
            description="These settings as one JSON document, in the format other apps built on agent-core read. It covers Model and Voice as well as this panel."
            content={<CopySpec />}
          />
        </>
      )}
    />
  );
}
