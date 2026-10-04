import {
  Cpu,
  LayoutDashboard,
  LinkIcon,
  Mic,
  Server,
  SlidersHorizontal,
  Smartphone,
} from "@/components/app/app-icons";

/**
 * The panels behind `/settings`, in the order they are shown.
 *
 * Model, Agent and Voice are three views of one settings row — see `config-form.tsx` — and
 * they lead because nothing further down has anything to show until the first of them is
 * filled in. The four after them each store their settings somewhere else.
 *
 * A table rather than a list written out in the screen, because two other places need it:
 * the tab row itself, and `SettingsLink`, which sends someone who is stuck to the panel that
 * unsticks them and wants to spell its name the same way the tab does.
 */
export const SETTINGS_TABS = [
  { key: "model", label: "Model", icon: Cpu },
  { key: "agent", label: "Agent", icon: SlidersHorizontal },
  { key: "voice", label: "Voice", icon: Mic },
  { key: "mcp", label: "MCP", icon: Server },
  { key: "apps", label: "Apps", icon: LayoutDashboard },
  { key: "server", label: "Server", icon: LinkIcon },
  { key: "device", label: "Device", icon: Smartphone },
] as const satisfies readonly { key: string; label: string; icon: typeof Cpu }[];

export type SettingsTab = (typeof SETTINGS_TABS)[number]["key"];

export const settingsTabLabel = (tab: SettingsTab) =>
  SETTINGS_TABS.find((entry) => entry.key === tab)?.label ?? "";

/** The route that opens one, which `app/settings.tsx` reads back off the URL. */
export const settingsHref = (tab: SettingsTab) => `/settings?tab=${tab}`;
