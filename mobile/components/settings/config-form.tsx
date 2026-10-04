import type { LlmConfigView, ReasoningEffort } from "@shared/types.ts";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useAppForm } from "@/components/app/app-form";
import { Save } from "@/components/app/app-icons";
import { StickyHeaderContentFooter } from "@/components/header-content-footer";
import { QueryState } from "@/components/query-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client.ts";
import { useReportDirty } from "./dirty.tsx";
import type { SettingsTab } from "./tabs.ts";

/**
 * The one settings row, behind the three panels that each edit a part of it.
 *
 * Model, Agent and Voice are three views of one Postgres row, and each is a form of its own:
 * its own fields, its own Save and its own Revert. What makes that safe is that a panel's form
 * holds only the fields that are on it and saves only those — a patch, not the row. Three
 * forms each holding the whole row would each write back their own copy of the other two's
 * fields, so keeping a system prompt would quietly put the voice settings back to whatever
 * they were when that panel first loaded.
 */

/** The fields of the settings row a panel can edit, in the shape a form holds them. */
export type Draft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  systemPrompt: string;
  pricing: { inputPer1M: number; outputPer1M: number };
  contextLimit: number;
  toolDiscovery: "eager" | "ondemand" | "proxy";
  reasoningEffort: ReasoningEffort;
  taskModels: Record<string, string>;
  voiceBaseUrl: string;
  sttModel: string;
  ttsModel: string;
  ttsVoice: string;
  speakReplies: boolean;
};

/** The panels that edit this row. The other settings tabs store their settings elsewhere. */
export type ConfigTab = Extract<SettingsTab, "model" | "agent" | "voice">;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The form over one panel's fields.
 *
 * Its defaults are the stored values, so they move whenever the row does. TanStack adopts new
 * defaults as the values only while nothing has been touched: a refetch behind a half-typed
 * form changes what "unsaved" is measured against without taking the typing away.
 *
 * A function of its own so that its return type can be named — the form's type has a dozen
 * parameters and every one of them is inferred here.
 */
function useSliceForm<T extends Partial<Draft>>({
  stored,
  onEdit,
  onSave,
}: {
  stored: T;
  /** A field was changed by hand. */
  onEdit: () => void;
  /** Resolves with the panel's fields as they were written, or throws. */
  onSave: (value: T) => Promise<T>;
}) {
  return useAppForm({
    defaultValues: stored,
    listeners: { onChange: onEdit },
    onSubmit: async ({ value, formApi }) => {
      try {
        // Reset to what the save read back, rather than left for the refetch to fill in: the
        // form would otherwise sit on the pre-save defaults until then, and a successful save
        // would look like one that had left everything unsaved.
        formApi.reset(await onSave(value));
      } catch {
        // Shown by the bar, from the mutation. Swallowed here so the submit settles.
      }
    },
  });
}

export type ConfigFormApi<T extends Partial<Draft>> = ReturnType<typeof useSliceForm<T>>;

export type ConfigSlice<T extends Partial<Draft>> = {
  /** The panel's form, for `form.AppField`. */
  form: ConfigFormApi<T>;
  /** What is in the form now, for the hints that quote a field. */
  draft: T;
  /** The stored row — every panel's fields, as saved. */
  view: LlmConfigView;
  /** This panel is holding a change. */
  dirty: boolean;
};

type ConfigFormProps<T extends Partial<Draft>> = {
  tab: ConfigTab;
  /** The panel's fields, taken from the stored row. This is also the list of what Save writes. */
  fields: (view: LlmConfigView) => T;
  /**
   * The form's values in the shape the stored ones are in, where the two can differ without
   * there being a change — see the Model panel's task models.
   */
  tidy?: ((draft: T) => unknown) | undefined;
  /** Called with the row as it was written, after a save. */
  onSaved?: (() => void) | undefined;
  content: (slice: ConfigSlice<T>) => ReactNode;
};

/**
 * One settings panel as a form: its fields, and a Save and Revert pinned under them.
 *
 * A render prop rather than a hook handing back the form, so that the three panels do not each
 * repeat the loading branch, the scroll container and the bar — and so that the fields inside
 * are written against a row that is known to have arrived.
 */
export function ConfigForm<T extends Partial<Draft>>(props: ConfigFormProps<T>) {
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  if (config.data) return <Loaded {...props} view={config.data} />;
  return (
    <StickyHeaderContentFooter
      width="prose"
      className="flex-1"
      contentClassName="py-4"
      content={<QueryState query={config} what="the settings" count={1} />}
    />
  );
}

/** The form itself, mounted once there is a row to seed it from. */
function Loaded<T extends Partial<Draft>>({
  tab,
  fields,
  tidy,
  onSaved,
  content,
  view,
}: ConfigFormProps<T> & { view: LlmConfigView }) {
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);

  const save = useMutation({
    mutationFn: (value: T) => api.saveConfig(value),
    onSuccess: (fresh) => {
      setSaved(true);
      queryClient.setQueryData(["config"], fresh);
      onSaved?.();
    },
  });

  // `fields` is written inline by the panel, so it is new every render and not a dependency.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  const stored = useMemo(() => fields(view), [view]);

  const form = useSliceForm({
    stored,
    // The note beside the button describes the last save, and an edit outdates it.
    onEdit: () => setSaved(false),
    onSave: async (value) => fields(await save.mutateAsync(value)),
  });
  const draft = useStore(form.store, (state) => state.values);

  // Measured against the stored values rather than set by a keystroke, so putting a value back
  // the way it was is not a change.
  const shape = (value: T) => JSON.stringify(tidy ? tidy(value) : value);
  const dirty = shape(draft) !== shape(stored);
  useReportDirty(tab, dirty);

  /*
    Pinned under the form rather than at the end of it. A panel is cards long and Save used to
    be past all of them, so the way to keep a change was to scroll back down past everything
    you had just read. It appears when there is something to do with it: a change to keep, or
    a save to confirm.
  */
  const bar =
    dirty || saved || save.error ? (
      <form.AppForm>
        <View className="gap-2 border-border border-t bg-background p-3">
          {save.error ? (
            <Alert
              variant="destructive"
              title="Could not save the settings"
              description={messageOf(save.error)}
            />
          ) : null}
          <View className="flex-row items-center gap-3">
            <Text className="flex-1 text-muted-foreground text-sm">
              {dirty ? "Unsaved changes" : "Saved"}
            </Text>
            {dirty ? (
              <>
                <Button
                  variant="outline"
                  onPress={() => {
                    setSaved(false);
                    save.reset();
                    form.reset();
                  }}
                >
                  Revert
                </Button>
                <form.SubmitButton
                  createLabel="Save"
                  savingLabel="Saving…"
                  icon={<Save className="size-4" />}
                />
              </>
            ) : null}
          </View>
        </View>
      </form.AppForm>
    ) : null;

  return (
    <StickyHeaderContentFooter
      width="prose"
      className="flex-1"
      // The body is a block on the web, where a slot wraps a caller's nodes; the cards want a column.
      contentClassName="flex flex-col gap-4 py-4"
      content={content({ form, draft, view, dirty })}
      footer={bar}
    />
  );
}
