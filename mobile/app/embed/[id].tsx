import { type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { Linking, Platform, View } from "react-native";
import {
  Button,
  Card,
  CardDescription,
  CardTitle,
  Empty,
  ErrorNote,
  Loading,
  Muted,
  Screen,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME } from "@/lib/embeds.ts";

/**
 * One of the other apps, shown inside min-agent.
 *
 * It is framed, not integrated: the iframe below points at a server min-agent knows nothing
 * about beyond its address. Nothing is proxied and no state is shared, so the app in the frame
 * behaves exactly as it does in its own tab — including refusing to be framed at all, which is
 * why "Open in the browser" is always on the header rather than only when something has
 * already gone wrong. `X-Frame-Options` and a `frame-ancestors` CSP are enforced by the
 * browser and are invisible to us: a blocked embed is a blank rectangle with no event to
 * catch, so the way out has to be there before anyone needs it.
 */

/** Only the web and desktop builds have an iframe; Android has no WebView compiled in. */
const canFrame = Platform.OS === "web";

const open = (embed: EmbedConfig) => Linking.openURL(embed.url);

export default function EmbedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const navigation = useNavigation();
  const embeds = useQuery({
    queryKey: ["embeds"],
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const embed = embeds.data?.find((item) => item.id === id);

  // The header is the drawer's, so the title and the escape hatch are set on it rather than
  // drawn again above the frame — a second bar would cost the frame a strip of height on
  // every one of these screens.
  useEffect(() => {
    navigation.setOptions({
      title: embed ? embedTitle(embed) : "App",
      headerRight: embed
        ? () => (
            <Button
              variant="ghost"
              size="icon"
              icon="external-link"
              accessibilityLabel="Open in the browser"
              onPress={() => open(embed)}
            />
          )
        : undefined,
    });
  }, [navigation, embed]);

  if (embeds.isError)
    return (
      <Screen>
        <ErrorNote error={embeds.error} />
      </Screen>
    );
  if (embeds.isLoading) return <Loading />;
  if (!embed)
    return (
      <Screen>
        <Empty>No app is configured under “{id}”. Add one on the Apps screen.</Empty>
      </Screen>
    );

  if (embed.mode === "iframe" && canFrame) {
    return (
      <View className="flex-1 bg-background">
        {/*
          A DOM element in a React Native tree, which only works because react-native-web
          renders through react-dom — hence the `canFrame` guard above rather than a check
          inside the JSX. Deliberately unsandboxed: these are the user's own apps on their own
          network, and a sandbox without `allow-scripts allow-same-origin` breaks every one
          worth embedding, while a sandbox *with* both is the same as none at all.
        */}
        <iframe
          src={embed.url}
          title={embedTitle(embed)}
          style={{ border: 0, width: "100%", height: "100%" }}
        />
      </View>
    );
  }

  return (
    <Screen>
      <Card>
        <CardTitle>{embedTitle(embed)}</CardTitle>
        <CardDescription>
          {embed.mode === "external"
            ? "Set to open in the browser rather than in a frame."
            : "This build cannot frame another app, so it opens in the browser instead."}
        </CardDescription>
        <Muted>{embed.url}</Muted>
        <View className="flex-row">
          <Button icon="external-link" onPress={() => open(embed)}>
            Open
          </Button>
        </View>
      </Card>
    </Screen>
  );
}
