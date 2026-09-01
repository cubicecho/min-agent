import { Feather } from "@react-native-vector-icons/feather";
import { SETTINGS_STALE_TIME } from "@shared/client/queries.ts";
import { embedTitle } from "@shared/types.ts";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { DarkTheme, ThemeProvider, useRouter } from "expo-router";
import {
  Drawer,
  type DrawerContentComponentProps,
  DrawerContentScrollView,
  DrawerItem,
  DrawerItemList,
} from "expo-router/drawer";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { type ColorValue, Linking, Platform, Pressable, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../global.css";
import { Separator } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME, visibleEmbeds } from "@/lib/embeds.ts";
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

// Sessions have to stay fresh — the list is redrawn after every turn — but these two do not.
queryClient.setQueryDefaults(["config"], { staleTime: SETTINGS_STALE_TIME });
queryClient.setQueryDefaults(["models"], { staleTime: SETTINGS_STALE_TIME });

type IconName = React.ComponentProps<typeof Feather>["name"];

const icon = (name: IconName) =>
  function DrawerIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Feather name={name} color={color as string} size={size} />;
  };

const SIDEBAR_WIDE = 232;
const SIDEBAR_RAIL = 64;

/**
 * The nav. It differs from the stock drawer content in two things: the button at the top,
 * which opens the web rail out to the full list and folds it back, and the configured apps
 * under the separator. The screens themselves are still react-navigation's `DrawerItemList`,
 * so the active row and the routing behave as they always did.
 *
 * The apps cannot be `Drawer.Screen`s — there is no route per app, only `embed/[id]` and a
 * list of rows in the database — so they are `DrawerItem`s driven by the query. A row in
 * `external` mode is not a destination in this app at all and hands its URL straight to the
 * browser rather than routing anywhere.
 */
function Sidebar({
  expanded,
  onToggle,
  ...props
}: DrawerContentComponentProps & { expanded: boolean; onToggle?: () => void }) {
  const router = useRouter();
  const embeds = useQuery({
    queryKey: ["embeds"],
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const apps = visibleEmbeds(embeds.data);

  // Which app the frame is currently showing, so its row is the highlighted one. The drawer
  // has a single `embed/[id]` route, so the id has to come out of that route's params rather
  // than from the route name the way every other item's does.
  const route = props.state.routes[props.state.index];
  const activeId =
    route?.name === "embed/[id]" ? (route.params as { id?: string } | undefined)?.id : undefined;

  // The rail keeps labels in the tree and only takes them out of the layout, matching what
  // `drawerLabelStyle` does for the screens above.
  const railed = Platform.OS === "web" && !expanded;

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ paddingTop: 0 }}>
      {onToggle && (
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
      )}
      <DrawerItemList {...props} />
      {apps.length > 0 && (
        <>
          <Separator className="my-2" />
          {apps.map((embed) => (
            <DrawerItem
              key={embed.id}
              label={embedTitle(embed)}
              icon={({ color, size }) => <Feather name={embed.icon} color={color} size={size} />}
              focused={embed.id === activeId}
              labelStyle={railed ? { display: "none" } : undefined}
              style={railed ? { paddingRight: 0 } : undefined}
              onPress={() =>
                embed.mode === "external"
                  ? Linking.openURL(embed.url)
                  : router.navigate(`/embed/${embed.id}`)
              }
            />
          ))}
        </>
      )}
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
            drawerContent={(props) => (
              <Sidebar
                {...props}
                expanded={expanded}
                // A drawer that slides over the content is never a rail, so it has nothing
                // to fold: the button is the web sidebar's alone.
                onToggle={onWeb ? () => setExpanded((open) => !open) : undefined}
              />
            )}
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
            {/*
              One route behind every configured app. It is hidden for the same reason
              `chat/[id]` is — the rows the sidebar draws for it are the destinations, and
              they are built from the database rather than from the file tree.
            */}
            <Drawer.Screen
              name="embed/[id]"
              options={{ title: "App", drawerItemStyle: { display: "none" } }}
            />
            <Drawer.Screen
              name="mcp"
              options={{ title: "MCP Servers", drawerIcon: icon("server") }}
            />
            <Drawer.Screen name="apps" options={{ title: "Apps", drawerIcon: icon("layout") }} />
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
