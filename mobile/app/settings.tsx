import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AgentPanel } from "@/components/settings/agent-panel.tsx";
import { AppsPanel } from "@/components/settings/apps-panel.tsx";
import { DirtyProvider, useDirtyPanels } from "@/components/settings/dirty.tsx";
import { McpPanel } from "@/components/settings/mcp-panel.tsx";
import { ServerPanel } from "@/components/settings/server-panel.tsx";
import { SETTINGS_TABS, type SettingsTab } from "@/components/settings/tabs.ts";
import { type TabMark, Tabs } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";

/**
 * Everything there is to set up, behind one nav row.
 *
 * These were four sibling screens in the drawer, which put the four things you configure at
 * the same level as the one thing you use — and the drawer is the app's nav, not its
 * preferences pane. They are panels now: one destination, one row of tabs, and a sidebar
 * that is chats and apps again.
 *
 * The tabs themselves are `components/settings/tabs.ts`, which `SettingsLink` reads too, so
 * a message that sends someone here names the panel the way its tab does.
 *
 * The panels are components under `components/settings/` rather than files here, because
 * every file under `app/` is a route and these are not routes any more. A panel is mounted
 * the first time you open its tab and kept from then on, hidden rather than unmounted, so
 * that a half-typed form is still there when you come back to it — the panels hold drafts,
 * and unmounting one threw its draft away without ever saying so. What is kept is a mounted
 * component and its queries, not a snapshot: the cost of that is a hidden panel that polls,
 * which is why each is told whether it is the one on screen.
 */

/** What every panel is handed: whether it is the tab currently on screen. */
export type PanelProps = { active: boolean };

/**
 * How often the shell asks after the MCP servers.
 *
 * Slower than the MCP panel's own poll, because this is only here to put a dot on the tab: a
 * server that fell over while you were on Agent is worth noticing, and it is not worth a
 * request every five seconds to notice it a little sooner.
 */
const MCP_WATCH = 30_000;

const PANELS: Record<SettingsTab, (props: PanelProps) => React.JSX.Element | null> = {
  agent: AgentPanel,
  mcp: McpPanel,
  apps: AppsPanel,
  server: ServerPanel,
};

const isTab = (value: string | undefined): value is SettingsTab => !!value && value in PANELS;

export default function SettingsScreen() {
  const router = useRouter();
  // `/settings?tab=mcp` opens on that tab, so a link can point at one. The param only seeds
  // the state; the state is what the row reads. Were the param the source of truth, a tab
  // would be dead on any platform where the URL is not the address bar.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [active, setActive] = useState<SettingsTab>(isTab(tab) ? tab : "agent");
  // Mounted so far. A panel is only built when it is first asked for, and never taken down.
  const [visited, setVisited] = useState<SettingsTab[]>([active]);

  // Same key the MCP panel reads, so opening that tab shows what is already in hand and the
  // two polls share one cache entry rather than racing each other.
  const mcp = useQuery({ queryKey: ["mcp"], queryFn: api.mcp, refetchInterval: MCP_WATCH });
  const { dirty, report } = useDirtyPanels();

  // A broken server outranks an unsaved form: one is something that happened to you, the
  // other is something you did and can still see when you go back.
  const marks: Partial<Record<string, TabMark>> = {};
  for (const [key, value] of Object.entries(dirty)) if (value) marks[key] = "unsaved";
  if (mcp.data?.some((server) => server.status === "error")) marks.mcp = "attention";

  const open = (key: string) => {
    if (!isTab(key)) return;
    setActive(key);
    setVisited((current) => (current.includes(key) ? current : [...current, key]));
    // Keeps the web URL honest about which panel is open, so a reload or a shared link lands
    // back on it.
    router.setParams({ tab: key });
  };

  return (
    <View className="flex-1 bg-background">
      <Tabs tabs={SETTINGS_TABS} value={active} marks={marks} onChange={open} />
      <DirtyProvider value={report}>
        {visited.map((key) => {
          const Panel = PANELS[key];
          const shown = key === active;
          // `display: none` rather than a conditional render: the panel keeps its state, its
          // scroll position and its queries, and costs no layout while it is off screen.
          return (
            <View key={key} className="flex-1" style={shown ? undefined : { display: "none" }}>
              <Panel active={shown} />
            </View>
          );
        })}
      </DirtyProvider>
    </View>
  );
}
