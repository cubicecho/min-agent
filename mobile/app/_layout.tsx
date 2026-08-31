import { Feather } from "@react-native-vector-icons/feather";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, ThemeProvider } from "expo-router";
import { Drawer } from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import type { ColorValue } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";
import { loadServerUrl } from "@/lib/server-url.ts";
import { colors } from "@/lib/theme.ts";

/**
 * The drawer, its header and the screen behind them are painted by react-navigation, not
 * by Tailwind, so the palette has to be handed over here as well or the frame stays light
 * around dark content. The theming primitives come from expo-router rather than from
 * @react-navigation/native, which SDK 56 refuses to let app code import directly.
 */
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: colors.background,
    card: colors.card,
    text: colors.foreground,
    border: colors.border,
    primary: colors.foreground,
  },
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

type IconName = React.ComponentProps<typeof Feather>["name"];

const icon = (name: IconName) =>
  function DrawerIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color as string} size={size} />;
  };

export default function RootLayout() {
  // Nothing may render until the stored server address is in memory, or the first
  // queries fire at the default address and fail.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadServerUrl().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navigationTheme}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Drawer screenOptions={{ drawerType: "slide" }}>
            <Drawer.Screen
              name="index"
              options={{ title: "Chats", drawerIcon: icon("message-square") }}
            />
            {/* Reached by tapping a session, so it is not a destination of its own. */}
            <Drawer.Screen
              name="chat/[id]"
              options={{ title: "Chat", drawerItemStyle: { display: "none" } }}
            />
            <Drawer.Screen
              name="mcp"
              options={{ title: "MCP Servers", drawerIcon: icon("server") }}
            />
            <Drawer.Screen name="cron" options={{ title: "Cron", drawerIcon: icon("clock") }} />
            <Drawer.Screen
              name="config"
              options={{ title: "Config", drawerIcon: icon("sliders") }}
            />
            <Drawer.Screen
              name="settings"
              options={{ title: "Settings", drawerIcon: icon("wifi") }}
            />
          </Drawer>
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
