import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { HeaderContentFooter } from "@/components/header-content-footer";
import { PageHeader } from "@/components/page-header";
import { AgentPanel } from "@/components/settings/agent-panel.tsx";
import { AppsPanel } from "@/components/settings/apps-panel.tsx";
import { DevicePanel } from "@/components/settings/device-panel.tsx";
import { DirtyProvider, useDirtyPanels } from "@/components/settings/dirty.tsx";
import { McpPanel } from "@/components/settings/mcp-panel.tsx";
import { ModelPanel } from "@/components/settings/model-panel.tsx";
import { ServerPanel } from "@/components/settings/server-panel.tsx";
import { SETTINGS_TABS, type SettingsTab } from "@/components/settings/tabs.ts";
import { VoicePanel } from "@/components/settings/voice-panel.tsx";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/client.ts";
import { cn } from "@/lib/utils";

/**
 * Everything there is to set up, behind one nav row.
 *
 * These were four sibling screens in the nav, which put the four things you configure at
 * the same level as the one thing you use — and the sidebar is the app's nav, not its
 * preferences pane. They are panels now: one destination, one row of tabs, and a sidebar
 * that is chats and apps again.
 *
 * The tabs themselves are `components/settings/tabs.ts`, which `SettingsLink` reads too, so
 * a message that sends someone here names the panel the way its tab does.
 *
 * The screen is cubeui's page chassis with the page header on top, and not `PageLayout`: that
 * one scrolls its body, and here each panel is its own scroller — it has to be, for a hidden
 * panel to keep its place and for the config panels to pin their save bar under their fields.
 *
 * The panels are components under `components/settings/` rather than files here, because
 * every file under `app/` is a route and these are not routes any more. A panel is mounted
 * the first time you open its tab and kept from then on, hidden rather than unmounted, so
 * that a half-typed form is still there when you come back to it — the panels hold drafts,
 * and unmounting one threw its draft away without ever saying so. What is kept is a mounted
 * component and its queries, not a snapshot: the cost of that is a hidden panel that polls,
 * which is why each is told whether it is the one on screen.
 *
 * Model, Agent and Voice are three views of one settings row, and still a form each: a panel
 * holds and saves only its own fields. See `components/settings/config-form.tsx`.
 */

/** What every panel is handed: whether it is the tab currently on screen. */
export type PanelProps = { active: boolean };

/**
 * A dot on a tab, for the two things a panel needs to say while you are not looking at it:
 * something in there is broken, or something in there is typed and unsaved.
 */
type TabMark = "attention" | "unsaved";

const MARK_STYLE: Record<TabMark, string> = {
  attention: "bg-destructive",
  unsaved: "bg-muted-foreground",
};

const MARK_LABEL: Record<TabMark, string> = {
  attention: "needs attention",
  unsaved: "unsaved changes",
};

/**
 * How often the shell asks after the MCP servers.
 *
 * Slower than the MCP panel's own poll, because this is only here to put a dot on the tab: a
 * server that fell over while you were on Agent is worth noticing, and it is not worth a
 * request every five seconds to notice it a little sooner.
 */
const MCP_WATCH = 30_000;

const PANELS: Record<SettingsTab, (props: PanelProps) => React.JSX.Element | null> = {
  model: ModelPanel,
  agent: AgentPanel,
  voice: VoicePanel,
  mcp: McpPanel,
  apps: AppsPanel,
  server: ServerPanel,
  device: DevicePanel,
};

const isTab = (value: string | undefined): value is SettingsTab => !!value && value in PANELS;

export default function SettingsScreen() {
  const router = useRouter();
  // `/settings?tab=mcp` opens on that tab, so a link can point at one. The param only seeds
  // the state; the state is what the row reads. Were the param the source of truth, a tab
  // would be dead on any platform where the URL is not the address bar.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [active, setActive] = useState<SettingsTab>(isTab(tab) ? tab : "model");
  // Mounted so far. A panel is only built when it is first asked for, and never taken down.
  const [visited, setVisited] = useState<SettingsTab[]>([active]);

  // Same key the MCP panel reads, so opening that tab shows what is already in hand and the
  // two polls share one cache entry rather than racing each other.
  const mcp = useQuery({ queryKey: ["mcp"], queryFn: api.mcp, refetchInterval: MCP_WATCH });
  const { dirty, report } = useDirtyPanels();

  // A broken server outranks an unsaved form: one is something that happened to you, the
  // other is something you did and can still see when you go back.
  const marks: Partial<Record<SettingsTab, TabMark>> = {};
  for (const { key } of SETTINGS_TABS) if (dirty[key]) marks[key] = "unsaved";
  if (mcp.data?.some((server) => server.status === "error")) marks.mcp = "attention";

  const open = (key: string) => {
    if (!isTab(key)) return;
    setActive(key);
    setVisited((current) => (current.includes(key) ? current : [...current, key]));
    // Keeps the web URL honest about which panel is open, so a reload or a shared link lands
    // back on it.
    router.setParams({ tab: key });
  };

  const panels = visited.map((key) => {
    const Panel = PANELS[key];
    const shown = key === active;
    // `display: none` rather than a conditional render: the panel keeps its state, its scroll
    // position and its queries, and costs no layout while it is off screen.
    return (
      <View key={key} className="min-h-0 flex-1" style={shown ? undefined : { display: "none" }}>
        <Panel active={shown} />
      </View>
    );
  });

  return (
    <HeaderContentFooter
      className="h-full flex-1 bg-background"
      header={
        <PageHeader
          title="Settings"
          className="border-border border-b"
          content={
            <Tabs value={active} onValueChange={open}>
              {/* Sideways rather than wrapped or shrunk: the set is short and a phone is
                  narrow, so the tabs past the edge are a drag away and the ones on screen stay
                  legible. */}
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <TabsList aria-label="Settings panels" className="self-start">
                  {SETTINGS_TABS.map(({ key, label, icon: Icon }) => {
                    const mark = marks[key];
                    return (
                      <TabsTrigger key={key} value={key}>
                        <Icon />
                        {label}
                        {mark ? (
                          <View
                            role="img"
                            aria-label={MARK_LABEL[mark]}
                            className={cn("size-1.5 rounded-full", MARK_STYLE[mark])}
                          />
                        ) : null}
                      </TabsTrigger>
                    );
                  })}
                </TabsList>
              </ScrollView>
            </Tabs>
          }
        />
      }
      // The body is a block on the web; the panels need a column to take its height from.
      contentClassName="flex flex-col"
      content={<DirtyProvider value={{ dirty, report }}>{panels}</DirtyProvider>}
    />
  );
}
