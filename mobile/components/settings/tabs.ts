import type { IconName } from "@/components/ui.tsx";

/**
 * The panels behind `/settings`, in the order they are shown.
 *
 * A table rather than a list written out in the screen, because two other places need it:
 * the tab row itself, and `SettingsLink`, which sends someone who is stuck to the panel that
 * unsticks them and wants to spell its name the same way the tab does.
 */
export const SETTINGS_TABS = [
  { key: "agent", label: "Agent", icon: "sliders" },
  { key: "mcp", label: "MCP", icon: "server" },
  { key: "apps", label: "Apps", icon: "layout" },
  { key: "server", label: "Server", icon: "link" },
  { key: "device", label: "Device", icon: "smartphone" },
] as const satisfies readonly { key: string; label: string; icon: IconName }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

export const settingsTabLabel = (tab: SettingsTab) =>
  SETTINGS_TABS.find((entry) => entry.key === tab)?.label ?? "";

/** The route that opens one, which `app/settings.tsx` reads back off the URL. */
export const settingsHref = (tab: SettingsTab) => `/settings?tab=${tab}`;
