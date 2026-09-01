import { useLocalSearchParams, useRouter } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import { AgentPanel } from "@/components/settings/agent-panel.tsx";
import { AppsPanel } from "@/components/settings/apps-panel.tsx";
import { McpPanel } from "@/components/settings/mcp-panel.tsx";
import { ServerPanel } from "@/components/settings/server-panel.tsx";
import { type Tab, Tabs } from "@/components/ui.tsx";

/**
 * Everything there is to set up, behind one nav row.
 *
 * These were four sibling screens in the drawer, which put the four things you configure at
 * the same level as the one thing you use — and the drawer is the app's nav, not its
 * preferences pane. They are panels now: one destination, one row of tabs, and a sidebar
 * that is chats and apps again.
 *
 * The panels are components under `components/settings/` rather than files here, because
 * every file under `app/` is a route and these are not routes any more. Each one still
 * renders its own `Screen`, so it keeps its own scrolling and its own loading and error
 * states, and switching tabs unmounts the one you left — the same as navigating away from
 * it used to.
 */

const TABS: Tab[] = [
  { key: "agent", label: "Agent", icon: "sliders" },
  { key: "mcp", label: "MCP", icon: "server" },
  { key: "apps", label: "Apps", icon: "layout" },
  { key: "server", label: "Server", icon: "link" },
];

const PANELS: Record<string, () => React.JSX.Element | null> = {
  agent: AgentPanel,
  mcp: McpPanel,
  apps: AppsPanel,
  server: ServerPanel,
};

export default function SettingsScreen() {
  const router = useRouter();
  // `/settings?tab=mcp` opens on that tab, so a link can point at one. The param only seeds
  // the state; the state is what the row reads. Were the param the source of truth, a tab
  // would be dead on any platform where the URL is not the address bar.
  const { tab } = useLocalSearchParams<{ tab?: string }>();
  const [active, setActive] = useState(tab && tab in PANELS ? tab : "agent");

  const Panel = PANELS[active] ?? AgentPanel;

  return (
    <View className="flex-1 bg-background">
      <Tabs
        tabs={TABS}
        value={active}
        onChange={(key) => {
          setActive(key);
          // Keeps the web URL honest about which panel is open, so a reload or a shared
          // link lands back on it.
          router.setParams({ tab: key });
        }}
      />
      <Panel />
    </View>
  );
}
