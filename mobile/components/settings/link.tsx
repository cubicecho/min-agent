import { useRouter } from "expo-router";
import { type SettingsTab, settingsHref, settingsTabLabel } from "@/components/settings/tabs.ts";
import { Button } from "@/components/ui.tsx";

/**
 * The way out of a dead end.
 *
 * Every place that tells you something is unconfigured used to name a screen and leave you
 * to find it — and after the settings screens became tabs, some of them named a screen that
 * no longer existed. A message about a missing model is worth nothing next to the button
 * that opens the panel it is missing from, so the message carries one.
 */
export function SettingsLink({
  tab,
  children,
  variant = "outline",
  size = "sm",
}: {
  tab: SettingsTab;
  children?: string;
  variant?: "outline" | "ghost" | "secondary";
  size?: "sm" | "default";
}) {
  const router = useRouter();
  return (
    <Button
      variant={variant}
      size={size}
      icon="settings"
      onPress={() => router.navigate(settingsHref(tab))}
    >
      {children ?? `Settings → ${settingsTabLabel(tab)}`}
    </Button>
  );
}
