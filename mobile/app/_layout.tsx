import { SETTINGS_STALE_TIME } from "@shared/client/queries.ts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { Platform, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import "../global.css";
import { MessageSquare } from "@/components/app/app-icons";
import { UpdateBanner } from "@/components/app/update-banner.tsx";
import { ChatsSidebar, useNewChat } from "@/components/chat/session-list.tsx";
import { ErrorPage } from "@/components/error-page.tsx";
import { AppBarItem, SidebarItem } from "@/components/sidebar.tsx";
import { SidebarLayout } from "@/components/split-layout.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Plus, Settings } from "@/components/ui/icons";
import { loadDisplaySettings } from "@/lib/display-settings.ts";
import { useShortcut } from "@/lib/keys.ts";
import { useBottomInset, useWide } from "@/lib/layout.ts";
import { queryKeys } from "@/lib/queries.ts";
import { loadServerUrl } from "@/lib/server-url.ts";
import { colors, pinDarkAppearance } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";
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

/**
 * The frame every screen sits in: on a wide window a sidebar beside the page, with the chats
 * in it, and on a narrow one cubeui's bar over the page. Which of the two is drawn is a
 * breakpoint in the stylesheet, so nothing here opens or closes.
 *
 * The sidebar is the one place the window is measured: below the breakpoint there is no
 * sidebar to fill, and the chat list is a screen of its own at `/` (see `ChatsView`), so the
 * list is not mounted twice, once of them hidden.
 */
function Shell() {
  const router = useRouter();
  const pathname = usePathname();
  const top = useSafeAreaInsets().top;
  const bottom = useBottomInset();

  /*
    The shortcuts that are about the app rather than about a screen live here, because
    the frame is the one thing mounted on every route — bound in the session list they would
    stop working the moment you opened Settings. They are web-only, like everything in
    `lib/keys.ts`; a phone has no keyboard to press them with.
  */
  const newChat = useNewChat((id) => router.navigate(`/chat/${id}`));
  useShortcut("mod+n", () => newChat.mutate());
  useShortcut("mod+,", () => router.navigate("/settings"));

  const wide = useWide();
  const onChats = pathname === "/" || pathname.startsWith("/chat/");
  const onSettings = pathname === "/settings";
  const activeChat = pathname.startsWith("/chat/") ? pathname.slice("/chat/".length) : undefined;

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
          wide ? (
            <ChatsSidebar
              activeId={activeChat}
              brandSlot={<Brand />}
              footerSlot={
                <Link href="/settings" asChild>
                  <SidebarItem label="Settings" iconSlot={<Settings />} active={onSettings} />
                </Link>
              }
            />
          ) : undefined
        }
        brandSlot={<Brand />}
        navLabel="Main"
        navSlot={
          <>
            <Link href="/" asChild>
              <AppBarItem label="Chats" iconSlot={<MessageSquare />} active={onChats} />
            </Link>
            <Link href="/settings" asChild>
              <AppBarItem label="Settings" iconSlot={<Settings />} active={onSettings} />
            </Link>
          </>
        }
        actionSlot={
          <Button
            aria-label="New chat"
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
          // height is asked for outright there. The update banner sits over every screen and
          // draws nothing until there is an update waiting, which is only ever on Android.
          <View role="main" className={MAIN}>
            <UpdateBanner />
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
  // queries fire at the default address and fail. The dictation and display settings are read in the
  // same breath — they are wanted before the first press of the microphone, not before the first
  // frame, but one await is simpler than two lifetimes.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    Promise.all([loadServerUrl(), loadVoiceSettings(), loadDisplaySettings()]).finally(() =>
      setReady(true),
    );
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
      <ErrorPage error={error} reset={() => void retry()} details />
    </View>
  );
}
