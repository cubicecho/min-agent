import { type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Linking, Platform, Text, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { ExternalLink, LayoutGrid } from "@/components/app/app-icons";
import { CardLayout } from "@/components/card-layout";
import { HeaderContentFooter } from "@/components/header-content-footer";
import { EmptyState } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { SettingsLink } from "@/components/settings/link.tsx";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME } from "@/lib/embeds.ts";

/**
 * One of the other apps, shown inside min-agent.
 *
 * It is framed, not integrated: the iframe below points at a server min-agent knows nothing
 * about beyond its address. Nothing is proxied and no state is shared, so the app in the frame
 * behaves exactly as it does in its own tab — including refusing to be framed at all, which is
 * why "Open in the browser" is always in the header rather than only when something has
 * already gone wrong. `X-Frame-Options` and a `frame-ancestors` CSP are enforced by the
 * browser and are invisible to us: a blocked embed is a blank rectangle with no event to
 * catch, so the way out has to be there before anyone needs it.
 */

/** Only the web and desktop builds have an iframe; Android has no WebView compiled in. */
const canFrame = Platform.OS === "web";

const open = (embed: EmbedConfig) => Linking.openURL(embed.url);

export default function EmbedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const embeds = useQuery({
    queryKey: ["embeds"],
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const embed = embeds.data?.find((item) => item.id === id);

  if (!embed) {
    return (
      <PageLayout
        title="App"
        loading={embeds.isPending}
        content={
          <QueryState
            query={embeds}
            what="your apps"
            count={0}
            empty={
              <EmptyState
                icon={LayoutGrid}
                title={`No app is configured under “${id}”.`}
                action={<SettingsLink tab="apps" label="Add one" />}
              />
            }
          />
        }
      />
    );
  }

  if (embed.mode === "iframe" && canFrame) {
    return (
      // Not `PageLayout`, whose body scrolls: the frame is the body, and it fills what is left
      // under the header rather than sitting in a scroller of its own height.
      <HeaderContentFooter
        className="h-full"
        header={
          <PageHeader
            title={embedTitle(embed)}
            action={
              <ActionButton
                label="Open in the browser"
                variant="ghost"
                size="icon-sm"
                onPress={() => open(embed)}
              >
                <ExternalLink className="size-4" />
              </ActionButton>
            }
          />
        }
        content={
          <View className="flex-1 bg-background">
            {/*
              A DOM element in a React Native tree, which only works because react-native-web
              renders through react-dom — hence the `canFrame` guard above rather than a check
              inside the JSX. Deliberately unsandboxed: these are the user's own apps on their
              own network, and a sandbox without `allow-scripts allow-same-origin` breaks every
              one worth embedding, while a sandbox *with* both is the same as none at all.
            */}
            <iframe
              src={embed.url}
              title={embedTitle(embed)}
              style={{ border: 0, width: "100%", height: "100%" }}
            />
          </View>
        }
      />
    );
  }

  return (
    <PageLayout
      title={embedTitle(embed)}
      content={
        <CardLayout
          title={embedTitle(embed)}
          description={
            embed.mode === "external"
              ? "Set to open in the browser rather than in a frame."
              : "This build cannot frame another app, so it opens in the browser instead."
          }
          content={<Text className="text-muted-foreground text-sm">{embed.url}</Text>}
          footerActions={
            <Button className="gap-2" onPress={() => open(embed)}>
              <ExternalLink className="size-4" />
              Open
            </Button>
          }
        />
      }
    />
  );
}
