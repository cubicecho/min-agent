import { type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useQuery } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { Linking, Platform, View } from "react-native";
import { ActionButton } from "@/components/action-button";
import { ExternalLink, LayoutGrid } from "@/components/app/app-icons";
import { TITLE_ROW } from "@/components/app/title-row";
import { EMBED_ICON } from "@/components/apps/embed-icon";
import { HeaderContentFooter } from "@/components/header-content-footer";
import { EmptyState } from "@/components/page";
import { PageHeader } from "@/components/page-header";
import { PageLayout } from "@/components/page-layout";
import { QueryState } from "@/components/query-state";
import { SettingsLink } from "@/components/settings/link.tsx";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME } from "@/lib/embeds.ts";
import { cn } from "@/lib/utils";

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
        headerClassName={TITLE_ROW}
        loading={embeds.isPending}
        contentSlot={
          <QueryState
            query={embeds}
            what="your apps"
            count={0}
            emptySlot={
              <EmptyState
                icon={LayoutGrid}
                title={`No app is configured under “${id}”.`}
                actionSlot={<SettingsLink tab="apps" label="Add one" />}
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
        headerSlot={
          <PageHeader
            // A frame's title bar, not a page's: the app in the frame has a header of its own.
            level={3}
            className={cn("border-border border-b py-2", TITLE_ROW)}
            title={embedTitle(embed)}
            actionSlot={
              <ActionButton
                label="Open in the browser"
                variant="ghost"
                size="icon-sm"
                onPress={() => open(embed)}
                iconSlot={<ExternalLink className="size-4" />}
              />
            }
          />
        }
        contentSlot={
          // `h-full`, not `flex-1`: a percentage resolves whether the shell's body is a flex
          // column or a block box, and it has been both. Under a block body `flex-1` claims
          // nothing, and the frame's own `100%` falls back to the 150px an iframe has by default.
          <View className="h-full bg-background">
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
      headerClassName={TITLE_ROW}
      contentSlot={
        // The page already has the app's name over it, so this is the one thing left to say and
        // the one thing to do about it — not a card repeating the title across the whole pane.
        <EmptyState
          icon={EMBED_ICON[embed.icon]}
          level={2}
          title={
            embed.mode === "external"
              ? "Opens in the browser"
              : "This build cannot frame another app"
          }
          description={embed.url}
          actionSlot={
            <Button
              className="gap-2"
              onPress={() => open(embed)}
              iconSlot={<ExternalLink className="size-4" />}
              content="Open"
            />
          }
        />
      }
    />
  );
}
