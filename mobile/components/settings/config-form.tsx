import type { LlmConfigView, ReasoningEffort } from "@shared/types.ts";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useAppForm } from "@/components/app/app-form";
import { Save } from "@/components/app/app-icons";
import { StickyHeaderContentFooter } from "@/components/header-content-footer";
import type { SelectOption } from "@/components/option-select";
import { QueryState } from "@/components/query-state";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client.ts";
import { useReportDirty } from "./dirty.tsx";
import { type SettingsTab, settingsTabLabel } from "./tabs.ts";

/**
 * The one settings row, behind the three panels that edit parts of it.
 *
 * Agent, Model and Voice were a single panel until they were split, and the split is only safe
 * because of what is here: they are three views of one Postgres row, and three panels each
 * holding their own draft of it would each save their own copy of the other two's fields —
 * so keeping a system prompt would quietly put the voice settings back to whatever they were
 * when that panel first loaded. There is one form, held here, and the panels are field groups.
 *
 * Saving is likewise one act. The bar at the bottom of each panel writes the whole row and
 * says which panels the unsaved changes are on, because from the row's point of view there is
 * no such thing as saving only the Voice half.
 */

/** The fields of the settings row a panel can edit, in the shape the form holds them. */
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

const CONFIG_TABS = ["model", "agent", "voice"] as const satisfies readonly SettingsTab[];

/** The panels that edit this row. The other settings tabs store their settings elsewhere. */
export type ConfigTab = (typeof CONFIG_TABS)[number];

/**
 * Which panel each field is on.
 *
 * Written field-to-panel rather than panel-to-fields so that `Record<keyof Draft, ConfigTab>`
 * can require it to be complete: a column added to the config that nobody has placed is a type
 * error here, rather than a field that silently never marks its tab as holding a change.
 */
const PANEL_OF: Record<keyof Draft, ConfigTab> = {
  baseUrl: "model",
  apiKey: "model",
  model: "model",
  taskModels: "model",
  pricing: "model",
  maxTokens: "agent",
  temperature: "agent",
  maxToolIterations: "agent",
  contextLimit: "agent",
  toolDiscovery: "agent",
  reasoningEffort: "agent",
  systemPrompt: "agent",
  voiceBaseUrl: "voice",
  sttModel: "voice",
  ttsModel: "voice",
  ttsVoice: "voice",
  speakReplies: "voice",
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

/** Which panels are holding a change, comparing field by field so each dot is on the right tab. */
const dirtyTabsOf = (draft: Draft, stored: Draft): ConfigTab[] => {
  const [a, b] = [tidy(draft), tidy(stored)];
  const tabs = new Set<ConfigTab>();
  for (const key of Object.keys(PANEL_OF) as (keyof Draft)[]) {
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) tabs.add(PANEL_OF[key]);
  }
  return CONFIG_TABS.filter((tab) => tabs.has(tab));
};

/**
 * What the form holds before the row has arrived. Never drawn — a panel shows a skeleton until
 * there is a row — but the form hook has to be called on that render too, with something.
 */
const EMPTY: Draft = {
  baseUrl: "",
  apiKey: "",
  model: "",
  maxTokens: 0,
  temperature: 0,
  maxToolIterations: 0,
  systemPrompt: "",
  pricing: { inputPer1M: 0, outputPer1M: 0 },
  contextLimit: 0,
  toolDiscovery: "ondemand",
  reasoningEffort: "off",
  taskModels: {},
  voiceBaseUrl: "",
  sttModel: "",
  ttsModel: "",
  ttsVoice: "",
  speakReplies: false,
};

/** How the endpoint button last went: what the provider answered, or why it did not. */
type Probe = { ok: boolean; detail: string } | null;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * The form over the settings row.
 *
 * Its defaults are the stored row, so they move whenever the row does. TanStack adopts new
 * defaults as the values only while nothing has been touched: the first load fills the form in,
 * and a refetch behind a half-typed one changes what "unsaved" is measured against without
 * taking the typing away.
 *
 * A function of its own so that its return type can be named — the form's type has a dozen
 * parameters and every one of them is inferred here.
 */
function useConfigForm({
  stored,
  onEdit,
  onSave,
}: {
  stored: Draft | null;
  /** A field was changed by hand. `name` is the field's path. */
  onEdit: (name: string) => void;
  /** Resolves with the row as it was written, or throws. */
  onSave: (value: Draft) => Promise<LlmConfigView>;
}) {
  return useAppForm({
    defaultValues: stored ?? EMPTY,
    listeners: { onChange: ({ fieldApi }) => onEdit(fieldApi.name) },
    onSubmit: async ({ value, formApi }) => {
      try {
        // Reset to what the save read back, rather than left for the refetch to fill in: the
        // form would otherwise sit on the pre-save defaults until then, and a successful save
        // would look like one that had left everything unsaved.
        formApi.reset(seed(await onSave(value)));
      } catch {
        // Shown by the bar, from the mutation. Swallowed here so the submit settles.
      }
    },
  });
}

type ConfigFormApi = ReturnType<typeof useConfigForm>;

export type ConfigDraft = {
  /** The form itself, for `form.AppField`. */
  form: ConfigFormApi;
  /** What is in the form now, for the fields whose hints quote other fields. */
  draft: Draft;
  /** The stored row, for the things a form shows about it — whether a key is already set. */
  view: LlmConfigView;
  /**
   * Something on Model, Agent or Voice is typed and not saved. It is one row behind three
   * panels, so anything that reads the *stored* row has to ask about all three, not its own.
   */
  dirty: boolean;
  /** Every model the provider at the *saved* endpoint reports, ready for a select. */
  modelOptions: SelectOption[];
  models: { count: number; error: unknown; loading: boolean; refetch: () => Promise<unknown> };
  /**
   * The endpoint in the boxes is not the one the model list came from.
   *
   * The whole reason the endpoint has a button of its own: the list is fetched by the server
   * from the provider it is configured with, so until the typed address is stored there is
   * nothing behind the model pickers but the last provider's answers.
   */
  endpointPending: boolean;
  applyEndpoint: () => void;
  endpointBusy: boolean;
  probe: Probe;
};

type Held = {
  state: ConfigDraft | null;
  /** The shared save bar, built once and rendered by whichever panel is on screen. */
  bar: ReactNode;
  /** Which panels are holding a change, so each one can report its own dot. */
  dirtyTabs: ConfigTab[];
  /** The settings row's query; every panel shows its failure rather than spinning forever. */
  query: { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };
};

const Context = createContext<Held | null>(null);

/**
 * Holds the form for as long as the settings screen is open.
 *
 * Above the panels rather than inside one, because a panel is unmounted only when the screen
 * is, and the form has to outlive any one of them being visited.
 */
export function ConfigDraftProvider({ content }: { content: ReactNode }) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [saved, setSaved] = useState(false);
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [probe, setProbe] = useState<Probe>(null);

  const save = useMutation({
    mutationFn: (value: Draft) => api.saveConfig(value),
    onSuccess: (fresh) => {
      setSaved(true);
      queryClient.setQueryData(["config"], fresh);
      // The model list belongs to the provider, so a new base URL or key means a new list.
      void queryClient.invalidateQueries({ queryKey: ["models"] });
    },
  });

  const stored = useMemo(() => (config.data ? seed(config.data) : null), [config.data]);

  const form = useConfigForm({
    stored,
    onEdit: (name) => {
      // The note beside the button describes the last save, and an edit outdates it.
      setSaved(false);
      // So does the endpoint badge, which describes a provider that is no longer the one in the
      // boxes — a green "Connected" beside a half-retyped address is the wrong thing to believe.
      if (name === "baseUrl" || name === "apiKey") setProbe(null);
    },
    onSave: save.mutateAsync,
  });
  const draft = useStore(form.store, (state) => state.values);
  const dirtyTabs = stored ? dirtyTabsOf(draft, stored) : [];

  /**
   * Store just the endpoint, then ask the provider what it serves.
   *
   * A patch rather than a whole save: this button answers "point at this provider", and it
   * would be a poor answer to it that also committed a half-written system prompt two tabs
   * away. For the same reason only the two fields it wrote are refreshed in the form — a
   * reset to the response would throw away every other unsaved edit.
   */
  const applyEndpoint = async () => {
    if (!stored) return;
    setEndpointBusy(true);
    setProbe(null);
    try {
      const { baseUrl, apiKey } = form.state.values;
      const fresh = await api.saveConfig({ baseUrl, apiKey });
      queryClient.setQueryData(["config"], fresh);
      form.setFieldValue("baseUrl", fresh.baseUrl);
      form.setFieldValue("apiKey", "");
      const result = await models.refetch();
      if (result.error) throw result.error;
      const count = result.data?.models.length ?? 0;
      setProbe({
        ok: true,
        detail: `${fresh.baseUrl || "the default endpoint"} — ${count} model(s)`,
      });
    } catch (error) {
      setProbe({ ok: false, detail: messageOf(error) });
    } finally {
      setEndpointBusy(false);
    }
  };

  const state: ConfigDraft | null =
    stored && config.data
      ? {
          form,
          draft,
          view: config.data,
          dirty: dirtyTabs.length > 0,
          modelOptions: (models.data?.models ?? []).map((entry) => ({
            label: entry.id,
            value: entry.id,
          })),
          models: {
            count: models.data?.models.length ?? 0,
            error: models.error,
            loading: models.isFetching,
            refetch: () => models.refetch(),
          },
          endpointPending: draft.baseUrl !== stored.baseUrl || Boolean(draft.apiKey),
          applyEndpoint: () => void applyEndpoint(),
          endpointBusy,
          probe,
        }
      : null;

  /*
    Pinned under the form rather than at the end of it. A panel is cards long and Save used to
    be past all of them, so the way to keep a change was to scroll back down past everything
    you had just read. It appears when there is something to do with it: a change to keep, or
    a save to confirm.
  */
  const bar =
    dirtyTabs.length > 0 || saved || save.error ? (
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
              {dirtyTabs.length === 0
                ? "Saved"
                : `Unsaved changes on ${dirtyTabs.map(settingsTabLabel).join(", ")}`}
            </Text>
            {dirtyTabs.length > 0 ? (
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
    <Context.Provider value={{ state, bar, dirtyTabs, query: config }}>{content}</Context.Provider>
  );
}

/**
 * One panel's worth of the settings form: its own fields, and the shared save bar under them.
 *
 * A render prop rather than a hook handing back the form, so that the three panels do not each
 * repeat the loading branch, the scroll container and the bar — and so that the fields inside
 * are written against a row that is known to have arrived.
 */
export function ConfigForm({
  tab,
  content,
}: {
  tab: ConfigTab;
  content: (config: ConfigDraft) => ReactNode;
}) {
  const held = useContext(Context);
  // Before the early returns: a mounted panel reports its dot on every render, and a hook
  // after a conditional return would not run on the renders where there is nothing to draw.
  useReportDirty(tab, held?.dirtyTabs.includes(tab) ?? false);

  if (!held) throw new Error("ConfigForm must be rendered inside a ConfigDraftProvider");

  return (
    <StickyHeaderContentFooter
      width="prose"
      className="flex-1"
      // The body is a block on the web, where a slot wraps a caller's nodes; the cards want a column.
      contentClassName="flex flex-col gap-4 py-4"
      content={
        held.state ? (
          content(held.state)
        ) : (
          <QueryState query={held.query} what="the settings" count={1} />
        )
      }
      footer={held.state ? held.bar : undefined}
    />
  );
}
