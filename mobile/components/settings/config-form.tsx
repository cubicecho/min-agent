import type { LlmConfigView, ReasoningEffort } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { View } from "react-native";
import { Button, ErrorNote, Loading, Muted, type Option, Screen } from "@/components/ui.tsx";
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
 * when that panel first loaded. There is one draft, held here, and the panels are field groups.
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
  toolDiscovery: "eager" | "ondemand";
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

/** How the endpoint button last went: what the provider answered, or why it did not. */
type Probe = { ok: boolean; detail: string } | null;

type ConfigDraft = {
  draft: Draft;
  /** The stored row, for the things a form shows about it — whether a key is already set. */
  view: LlmConfigView;
  set: <K extends keyof Draft>(key: K, value: Draft[K]) => void;
  /** Every model the provider at the *saved* endpoint reports, ready for a `Select`. */
  modelOptions: Option[];
  models: { count: number; error: unknown; loading: boolean; refetch: () => void };
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
  /** The settings row failed to load; every panel says so rather than spinning forever. */
  error: unknown;
};

const Context = createContext<Held | null>(null);

/**
 * Holds the draft for as long as the settings screen is open.
 *
 * Above the panels rather than inside one, because a panel is unmounted only when the screen
 * is, and the draft has to outlive any one of them being visited.
 */
export function ConfigDraftProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [endpointBusy, setEndpointBusy] = useState(false);
  const [probe, setProbe] = useState<Probe>(null);

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

  const stored = config.data ? seed(config.data) : null;
  const dirtyTabs = draft && stored ? dirtyTabsOf(draft, stored) : [];

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    // The note beside the button describes the last save, and an edit outdates it.
    setSaved(false);
    // So does the endpoint badge, which describes a provider that is no longer the one in the
    // boxes — a green "Connected" beside a half-retyped address is the wrong thing to believe.
    if (key === "baseUrl" || key === "apiKey") setProbe(null);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  };

  /**
   * Store just the endpoint, then ask the provider what it serves.
   *
   * A patch rather than a whole save: this button answers "point at this provider", and it
   * would be a poor answer to it that also committed a half-written system prompt two tabs
   * away. For the same reason only the two fields it wrote are refreshed in the draft — a
   * reseed from the response would throw away every other unsaved edit.
   */
  const applyEndpoint = async () => {
    if (!draft) return;
    setEndpointBusy(true);
    setProbe(null);
    try {
      const fresh = await api.saveConfig({ baseUrl: draft.baseUrl, apiKey: draft.apiKey });
      queryClient.setQueryData(["config"], fresh);
      setDraft((current) =>
        current ? { ...current, baseUrl: fresh.baseUrl, apiKey: "" } : current,
      );
      const result = await models.refetch();
      if (result.error) throw result.error;
      const count = result.data?.models.length ?? 0;
      setProbe({
        ok: true,
        detail: `${fresh.baseUrl || "the default endpoint"} — ${count} model(s)`,
      });
    } catch (error) {
      setProbe({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setEndpointBusy(false);
    }
  };

  const state: ConfigDraft | null =
    draft && config.data
      ? {
          draft,
          view: config.data,
          set,
          modelOptions: (models.data?.models ?? []).map((entry) => ({
            label: entry.id,
            value: entry.id,
          })),
          models: {
            count: models.data?.models.length ?? 0,
            error: models.error,
            loading: models.isFetching,
            refetch: () => void models.refetch(),
          },
          endpointPending: Boolean(stored && (draft.baseUrl !== stored.baseUrl || draft.apiKey)),
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
      <View className="gap-2 border-t border-border bg-background p-3">
        <ErrorNote error={save.error} />
        <View className="flex-row items-center gap-3">
          <Muted className="flex-1">
            {dirtyTabs.length === 0
              ? "Saved"
              : `Unsaved changes on ${dirtyTabs.map(settingsTabLabel).join(", ")}`}
          </Muted>
          {dirtyTabs.length > 0 && stored && (
            <>
              <Button
                variant="outline"
                onPress={() => {
                  setSaved(false);
                  setDraft(stored);
                }}
              >
                Revert
              </Button>
              <Button icon="save" busy={save.isPending} onPress={() => draft && save.mutate(draft)}>
                Save
              </Button>
            </>
          )}
        </View>
      </View>
    ) : null;

  return (
    <Context.Provider value={{ state, bar, dirtyTabs, error: config.error }}>
      {children}
    </Context.Provider>
  );
}

/**
 * One panel's worth of the settings form: its own fields, and the shared save bar under them.
 *
 * A render prop rather than a hook handing back a draft, so that the three panels do not each
 * repeat the loading branch, the scroll container and the bar — and so that the fields inside
 * are written against a draft that is known to have arrived.
 */
export function ConfigForm({
  tab,
  children,
}: {
  tab: ConfigTab;
  children: (config: ConfigDraft) => ReactNode;
}) {
  const held = useContext(Context);
  // Before the early returns: a mounted panel reports its dot on every render, and a hook
  // after a conditional return would not run on the renders where there is nothing to draw.
  useReportDirty(tab, held?.dirtyTabs.includes(tab) ?? false);

  if (!held) throw new Error("ConfigForm must be rendered inside a ConfigDraftProvider");
  if (held.error)
    return (
      <Screen>
        <ErrorNote error={held.error} />
      </Screen>
    );
  if (!held.state) return <Loading />;

  return (
    <View className="flex-1">
      <Screen>
        {children(held.state)}
        <View className="pb-8" />
      </Screen>
      {held.bar}
    </View>
  );
}
