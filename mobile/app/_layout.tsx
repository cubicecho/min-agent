import { SETTINGS_STALE_TIME } from "@shared/client/queries.ts";
import { type EmbedConfig, embedTitle } from "@shared/types.ts";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import {
  DarkTheme,
  type ErrorBoundaryProps,
  Link,
  Stack,
  ThemeProvider,
  usePathname,
  useRouter,
} from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "../global.css";
import { ActionButton } from "@/components/action-button";
import { MessageSquare } from "@/components/app/app-icons";
import { EMBED_ICON } from "@/components/apps/embed-icon.ts";
import { useNewChat } from "@/components/chat/session-list.tsx";
import { RouteError } from "@/components/route-error";
import { BarNavItem, Sidebar, SidebarNavItem, SidebarSection } from "@/components/sidebar";
import { SidebarLayout } from "@/components/split-layout";
import { Button } from "@/components/ui/button";
import { Plus, Settings } from "@/components/ui/icons";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME, visibleEmbeds } from "@/lib/embeds.ts";
import { useShortcut } from "@/lib/keys.ts";
import { useBottomInset } from "@/lib/layout.ts";
import { queryKeys } from "@/lib/queries.ts";
import { loadServerUrl } from "@/lib/server-url.ts";
import { colors, pinDarkAppearance } from "@/lib/theme.ts";
import { cn } from "@/lib/utils";
import { loadVoiceSettings } from "@/lib/voice-settings.ts";

/**
 * The stack behind every screen is react-navigation's, not Tailwind's, so the palette has to
 * be handed over here as well or a screen flashes light before its own background paints.
 * The theming primitives come from expo-router rather than from @react-navigation/native,
 * which the SDK refuses to let app code import directly.
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

// Before the first frame, so nothing is painted in the system's scheme and then repainted.
pinDarkAppearance();

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

// Sessions have to stay fresh — the list is redrawn after every turn — but these two do not.
queryClient.setQueryDefaults(queryKeys.config, { staleTime: SETTINGS_STALE_TIME });
queryClient.setQueryDefaults(queryKeys.models, { staleTime: SETTINGS_STALE_TIME });

const MAIN = cn("min-h-0 min-w-0", Platform.select({ web: "h-full", default: "flex-1" }));

const Brand = () => <Text className="px-1 font-semibold text-foreground text-lg">min-agent</Text>;

/** An app set to `external` is not a place in this app: its row hands the URL to the browser. */
const openExternally = (embed: EmbedConfig) => Linking.openURL(embed.url);

/**
 * The frame every screen sits in: cubeui's rail beside the page on a wide window, and its bar
 * over the page on a narrow one. Which of the two is drawn is a breakpoint in the stylesheet,
 * so nothing here opens, closes or measures the window.
 *
 * The places are listed twice, once as rows for the rail and once as icons for the bar,
 * because the two are different components with one prop list. The configured apps are rows
 * in the database rather than routes, so both lists are built from the query: an `iframe` app
 * goes to `embed/[id]`, and an `external` one leaves for the browser.
 */
function Shell() {
  const router = useRouter();
  const pathname = usePathname();
  const top = useSafeAreaInsets().top;
  const bottom = useBottomInset();

  /*
    The two shortcuts that are about the app rather than about a screen live here, because
    the frame is the one thing mounted on every route — bound in the session list they would
    stop working the moment you opened Settings. They are web-only, like everything in
    `lib/keys.ts`; a phone has no keyboard to press them with.
  */
  const newChat = useNewChat((id) => router.navigate(`/chat/${id}`));
  useShortcut("mod+n", () => newChat.mutate());
  useShortcut("mod+,", () => router.navigate("/settings"));

  const embeds = useQuery({
    queryKey: queryKeys.embeds,
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  // Worked out once for the rail and the bar, which draw the same places with different rows.
  const apps = visibleEmbeds(embeds.data).map((embed) => {
    const Icon = EMBED_ICON[embed.icon];
    const href = `/embed/${embed.id}` as const;
    return {
      embed,
      label: embedTitle(embed),
      iconSlot: <Icon />,
      href,
      active: pathname === href,
      isExternal: embed.mode === "external",
    };
  });

  const onChats = pathname === "/" || pathname.startsWith("/chat/");
  const onSettings = pathname === "/settings";

  return (
    /*
      Android draws this app edge to edge — under the status bar, under the bar at the foot
      of the display, and under the keyboard, which no longer resizes the window — so the
      frame is padded by all three and each screen is free to simply fill what it is given.
      Here rather than in each screen, because a screen that forgets is a screen with its
      last button under the gesture pill.
    */
    <View className="flex-1 bg-background" style={{ paddingTop: top, paddingBottom: bottom }}>
      <SidebarLayout
        className="flex-1"
        sidebarPosition="start"
        sidebarWidth="auto"
        divider="none"
        sidebarHideBelow="md"
        sidebarSlot={
          <Sidebar
            label="min-agent"
            headerSlot={
              <>
                <Brand />
                <Button
                  size="sm"
                  className="w-full gap-2"
                  disabled={newChat.isPending}
                  onPress={() => newChat.mutate()}
                  iconSlot={<Plus className="size-4" />}
                  content="New chat"
                />
              </>
            }
            contentSlot={
              <View role="navigation" aria-label="Main">
                <SidebarSection
                  contentSlot={
                    <Link href="/" asChild>
                      <SidebarNavItem label="Chats" iconSlot={<MessageSquare />} active={onChats} />
                    </Link>
                  }
                />
                {apps.length > 0 ? (
                  <SidebarSection
                    title="Apps"
                    contentSlot={apps.map(({ embed, label, iconSlot, href, active, isExternal }) =>
                      isExternal ? (
                        <SidebarNavItem
                          key={embed.id}
                          label={label}
                          iconSlot={iconSlot}
                          onPress={() => openExternally(embed)}
                        />
                      ) : (
                        <Link key={embed.id} href={href} asChild>
                          <SidebarNavItem label={label} iconSlot={iconSlot} active={active} />
                        </Link>
                      ),
                    )}
                  />
                ) : null}
              </View>
            }
            footerSlot={
              <Link href="/settings" asChild>
                <SidebarNavItem label="Settings" iconSlot={<Settings />} active={onSettings} />
              </Link>
            }
          />
        }
        brandSlot={<Brand />}
        navLabel="Main"
        navSlot={
          <>
            <Link href="/" asChild>
              <BarNavItem label="Chats" iconSlot={<MessageSquare />} active={onChats} />
            </Link>
            {apps.map(({ embed, label, iconSlot, href, active, isExternal }) =>
              isExternal ? (
                // Always a link in the bar, so the address is its `href` on the web; the
                // press is what a device, which has no `href`, goes by.
                <BarNavItem
                  key={embed.id}
                  label={label}
                  iconSlot={iconSlot}
                  href={embed.url}
                  onPress={(event) => {
                    event.preventDefault();
                    openExternally(embed);
                  }}
                />
              ) : (
                <Link key={embed.id} href={href} asChild>
                  <BarNavItem label={label} iconSlot={iconSlot} active={active} />
                </Link>
              ),
            )}
            <Link href="/settings" asChild>
              <BarNavItem label="Settings" iconSlot={<Settings />} active={onSettings} />
            </Link>
          </>
        }
        actionSlot={
          <ActionButton
            label="New chat"
            variant="ghost"
            size="icon-sm"
            disabled={newChat.isPending}
            onPress={() => newChat.mutate()}
            iconSlot={<Plus className="size-4" />}
          />
        }
        contentSlot={
          // `role="main"` is what react-native-web turns into a <main>. It does not scroll:
          // each screen divides the height it is given between its own header and body.
          // cubeui's panes are block boxes on the web, where `flex-1` claims nothing, so the
          // height is asked for outright there.
          <View role="main" className={MAIN}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: "transparent" },
              }}
            />
          </View>
        }
      />
    </View>
  );
}

export default function RootLayout() {
  // Nothing may render until the stored server address is in memory, or the first
  // queries fire at the default address and fail. The dictation settings are read in the
  // same breath — they are wanted before the first press of the microphone, not before the
  // first frame, but one await is simpler than two lifetimes.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([loadServerUrl(), loadVoiceSettings()]).finally(() => setReady(true));
  }, []);

  const isLoading = ready === false;
  if (isLoading) {
    return null;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <ThemeProvider value={navigationTheme}>
        <QueryClientProvider client={queryClient}>
          <StatusBar style="light" />
          <Shell />
        </QueryClientProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}

/**
 * The last thing between a thrown render and a blank page. Expo Router looks for this named
 * export on a route file and wraps the route in it, so exporting it from the root layout
 * covers every screen. It sits outside the providers above — the throw may well have come
 * from inside them — so it uses nothing that needs one.
 */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <View className="flex-1 bg-background">
      <RouteError error={error} reset={() => void retry()} details />
    </View>
  );
}
