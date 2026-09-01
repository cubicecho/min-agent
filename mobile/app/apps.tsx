// biome-ignore-all lint/suspicious/noArrayIndexKey: rows are positional — every field is a controlled input owned by `draft`, so index is the identity.
import { EMBED_ICONS, type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Linking, Platform, Text, View } from "react-native";
import {
  Button,
  Card,
  CardDescription,
  ErrorNote,
  Field,
  Input,
  Loading,
  Muted,
  Screen,
  Select,
  Switch,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME } from "@/lib/embeds.ts";

/**
 * The other apps that get a row in the sidebar — a task server, a kanban board.
 *
 * Edited and saved as a whole list, the way the MCP tab is and for the same reason: an
 * embed's id is the route its view lives at, so renaming one is a new destination rather than
 * an edited row.
 */

const ICONS = EMBED_ICONS.map((icon) => ({ label: icon, value: icon }));

const MODES = [
  { label: "In a frame", value: "iframe" },
  { label: "In the browser", value: "external" },
];

const blank = (index: number): EmbedConfig => ({
  id: `app-${index}`,
  label: "",
  url: "",
  icon: "grid",
  mode: "iframe",
  enabled: true,
});

export default function AppsScreen() {
  const queryClient = useQueryClient();
  const embeds = useQuery({
    queryKey: ["embeds"],
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const [draft, setDraft] = useState<EmbedConfig[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (embeds.data && !draft) setDraft(embeds.data);
  }, [embeds.data, draft]);

  const save = useMutation({
    mutationFn: (value: EmbedConfig[]) => api.saveEmbeds(value),
    onSuccess: (fresh) => {
      setSaved(true);
      // Seeded from what the save read back rather than cleared, or the effect above refills
      // the form from the pre-save cache before the refetch can land — see the same note on
      // the MCP screen, where that bug was found.
      queryClient.setQueryData(["embeds"], fresh);
      setDraft(fresh);
    },
  });

  if (embeds.isError)
    return (
      <Screen>
        <ErrorNote error={embeds.error} />
      </Screen>
    );
  if (!draft) return <Loading />;

  const edit = (next: EmbedConfig[]) => {
    setSaved(false);
    setDraft(next);
  };

  const update = (index: number, patch: Partial<EmbedConfig>) =>
    edit(draft.map((embed, i) => (i === index ? { ...embed, ...patch } : embed)));

  return (
    <Screen>
      <Muted>
        Other web apps, given a row in the sidebar. They are not part of min-agent — a framed app is
        the other server’s own UI, running on its own.
      </Muted>
      {Platform.OS !== "web" && (
        <Muted>This build has no frame to put them in, so every app opens in the browser.</Muted>
      )}

      {draft.length === 0 && (
        <Card>
          <CardDescription>No apps yet. Add one to put it in the sidebar.</CardDescription>
        </Card>
      )}

      {draft.map((embed, index) => (
        <Card key={index}>
          <View className="flex-row items-center gap-2">
            <Text className="flex-1 text-base font-semibold text-card-foreground" numberOfLines={1}>
              {embedTitle(embed)}
            </Text>
            <Switch value={embed.enabled} onValueChange={(enabled) => update(index, { enabled })} />
            <Button
              variant="ghost"
              size="icon"
              icon="external-link"
              accessibilityLabel={`Open ${embedTitle(embed)}`}
              disabled={!embed.url}
              onPress={() => Linking.openURL(embed.url)}
            />
            <Button
              variant="ghost"
              size="icon"
              icon="trash-2"
              accessibilityLabel={`Remove ${embedTitle(embed)}`}
              onPress={() => edit(draft.filter((_, i) => i !== index))}
            />
          </View>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Id" hint="The route: /embed/<id>">
                <Input
                  value={embed.id}
                  onChangeText={(value) => update(index, { id: value })}
                  autoCapitalize="none"
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field label="Label">
                <Input
                  value={embed.label}
                  onChangeText={(value) => update(index, { label: value })}
                  placeholder="Kanban"
                />
              </Field>
            </View>
          </View>

          <Field
            label="URL"
            hint="An address every device that opens min-agent can reach — a LAN address, not localhost, if you use the phone or desktop build."
          >
            <Input
              value={embed.url}
              onChangeText={(value) => update(index, { url: value })}
              autoCapitalize="none"
              inputMode="url"
              placeholder="http://192.168.1.10:3000"
            />
          </Field>

          <View className="flex-row gap-3">
            <View className="flex-1">
              <Field label="Icon">
                <Select
                  value={embed.icon}
                  options={ICONS}
                  onChange={(value) => update(index, { icon: value as EmbedConfig["icon"] })}
                />
              </Field>
            </View>
            <View className="flex-1">
              <Field
                label="Opens"
                hint={
                  embed.mode === "iframe"
                    ? "Some servers refuse to be framed; switch to the browser if it comes up blank."
                    : undefined
                }
              >
                <Select
                  value={embed.mode}
                  options={MODES}
                  onChange={(value) => update(index, { mode: value as EmbedConfig["mode"] })}
                />
              </Field>
            </View>
          </View>
        </Card>
      ))}

      <ErrorNote error={save.error} />
      <View className="flex-row items-center gap-2 pb-8">
        <Button
          variant="outline"
          icon="plus"
          onPress={() => edit([...draft, blank(draft.length + 1)])}
        >
          Add app
        </Button>
        <Button icon="save" busy={save.isPending} onPress={() => save.mutate(draft)}>
          Save
        </Button>
        {saved && !save.isPending && <Muted>Saved</Muted>}
      </View>
    </Screen>
  );
}
