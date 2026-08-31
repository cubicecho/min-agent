import { Feather } from "@react-native-vector-icons/feather";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DarkTheme, ThemeProvider } from "expo-router";
import {
  Drawer,
  type DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItemList,
} from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { type ColorValue, Platform, Pressable, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";
import { useWide } from "@/lib/layout.ts";
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

const SIDEBAR_WIDE = 232;
const SIDEBAR_RAIL = 64;

/**
 * The web sidebar. It differs from the stock drawer content only in the button at the top,
 * which opens the rail out to the full list and folds it back; the items themselves are
 * still react-navigation's, so the active row and the routing behave as they always did.
 */
function Sidebar({
  expanded,
  onToggle,
  ...props
}: DrawerContentComponentProps & { expanded: boolean; onToggle: () => void }) {
  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 0 }}>
      <View style={{ alignItems: expanded ? "flex-end" : "center", paddingHorizontal: 8 }}>
        <Pressable
          onPress={onToggle}
          accessibilityRole="button"
          accessibilityLabel={expanded ? "Collapse the sidebar" : "Expand the sidebar"}
          style={{ alignItems: "center", height: 40, justifyContent: "center", width: 40 }}
        >
          <Feather
            name={expanded ? "chevrons-left" : "chevrons-right"}
            size={18}
            color={colors.mutedForeground}
          />
        </Pressable>
      </View>
      <DrawerItemList {...props} />
    </DrawerContentScrollView>
  );
}

export default function RootLayout() {
  // Nothing may render until the stored server address is in memory, or the first
  // queries fire at the default address and fail.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadServerUrl().finally(() => setReady(true));
  }, []);

  // On the web the nav is a sidebar, not something hidden behind a hamburger: `permanent`
  // pins it open beside the content and drops the toggle from the header. A window with
  // room for it gets the labels; a narrow one keeps the icons and opens out on request,
  // which is still a nav you can see rather than one you have to remember. On a phone it
  // stays the drawer that slides over the content, because 64px of rail is a lot of a
  // phone.
  const onWeb = Platform.OS === "web";
  const wide = useWide();
  const [expanded, setExpanded] = useState(wide);
  // A window dragged across the breakpoint gets the shape that fits it. Toggling by hand
  // afterwards sticks until the next crossing.
  useEffect(() => setExpanded(wide), [wide]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navigationTheme}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Drawer
            drawerContent={
              onWeb
                ? (props) => (
                    <Sidebar
                      {...props}
                      expanded={expanded}
                      onToggle={() => setExpanded((open) => !open)}
                    />
                  )
                : undefined
            }
            screenOptions={{
              drawerType: onWeb ? "permanent" : "slide",
              // A permanent drawer cannot be opened or closed, so the header's toggle is a
              // dead control; the sidebar's own button is the one that does something.
              headerLeft: onWeb ? () => null : undefined,
              drawerStyle: onWeb ? { width: expanded ? SIDEBAR_WIDE : SIDEBAR_RAIL } : undefined,
              // The rail keeps the labels in the tree for screen readers and only takes
              // them out of the layout, so an icon is still announced by name.
              drawerLabelStyle: onWeb && !expanded ? { display: "none" } : undefined,
              drawerItemStyle: onWeb && !expanded ? { paddingRight: 0 } : undefined,
            }}
          >
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
