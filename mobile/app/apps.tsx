import { Feather } from "@react-native-vector-icons/feather";
import { EMBED_ICONS, type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Linking, Platform, Pressable, Text, View } from "react-native";
import {
  Badge,
  Button,
  Dialog,
  Empty,
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
import { colors } from "@/lib/theme.ts";

/**
 * The other apps that get a row in the sidebar — a task server, a kanban board.
 *
 * The screen is a list and the editing happens in a dialog over it, because the list is the
 * thing you come here to read: which apps exist, which are on, where they point. Six form
 * fields per row said none of that until you had scrolled past them.
 *
 * There is no Save button. The mutation replaces the whole set — an embed's id is the route
 * its view lives at, so the server takes the list rather than a patch — and the dialog is the
 * unit of work: closing it has already saved, or has told you why it could not.
 */

const ICONS = EMBED_ICONS.map((icon) => ({ label: icon, value: icon }));

const MODES = [
  { label: "In a frame", value: "iframe" },
  { label: "In the browser", value: "external" },
];

/** How long a primed remove stays primed before it forgets it was ever asked. */
const ARMED_FOR = 5000;

const blank = (taken: EmbedConfig[]): EmbedConfig => {
  // Ids are unique or the save is refused, and the id of the row you just deleted is the one
  // the next `app-N` would land on.
  let n = taken.length + 1;
  while (taken.some((embed) => embed.id === `app-${n}`)) n += 1;
  return { id: `app-${n}`, label: "", url: "", icon: "grid", mode: "iframe", enabled: true };
};

/** Which row the dialog is editing: an index into the list, or a new row at the end. */
type Editing = { index: number | null; value: EmbedConfig };

/** One line of the list: what it is, where it points, and whether it is on. */
function Row({
  embed,
  onOpen,
  onToggle,
}: {
  embed: EmbedConfig;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${embedTitle(embed)}`}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 active:bg-muted"
    >
      <Feather
        name={embed.icon}
        size={17}
        color={embed.enabled ? colors.foreground : colors.mutedForeground}
      />
      <View className="flex-1">
        <Text
          className={`text-sm font-medium ${embed.enabled ? "text-card-foreground" : "text-muted-foreground"}`}
          numberOfLines={1}
        >
          {embedTitle(embed)}
        </Text>
        <Text className="text-xs text-muted-foreground" numberOfLines={1}>
          {embed.url || "No address yet"}
        </Text>
      </View>
      {embed.mode === "external" && <Badge variant="outline">browser</Badge>}
      <Switch value={embed.enabled} onValueChange={onToggle} />
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

/**
 * The create/edit form. It owns its own draft so typing does not re-render the list behind
 * it, and it is seeded afresh every time the dialog opens — `key` on the caller — rather than
 * syncing an effect against the row it was opened on.
 */
function Editor({
  initial,
  existing,
  busy,
  error,
  onCancel,
  onSave,
  onRemove,
}: {
  initial: EmbedConfig;
  existing: boolean;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (value: EmbedConfig) => void;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [armed, setArmed] = useState(false);

  // A remove left primed and forgotten is a delete waiting to happen on the next stray tap.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_FOR);
    return () => clearTimeout(timer);
  }, [armed]);

  const update = (patch: Partial<EmbedConfig>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog
      visible
      title={existing ? embedTitle(draft) : "Add an app"}
      onClose={onCancel}
      footer={
        <>
          {existing &&
            (armed ? (
              <Button size="sm" variant="destructive" busy={busy} onPress={onRemove}>
                Remove?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                icon="trash-2"
                accessibilityLabel={`Remove ${embedTitle(draft)}`}
                onPress={() => setArmed(true)}
              />
            ))}
          <Button
            variant="ghost"
            size="icon"
            icon="external-link"
            accessibilityLabel="Open in the browser"
            disabled={!draft.url}
            onPress={() => Linking.openURL(draft.url)}
          />
          <View className="flex-1" />
          <Button variant="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button icon="save" busy={busy} onPress={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      <Field label="Label">
        <Input
          value={draft.label}
          onChangeText={(label) => update({ label })}
          placeholder="Kanban"
          autoFocus={!existing}
        />
      </Field>

      <Field
        label="URL"
        hint="An address every device that opens min-agent can reach — a LAN address, not localhost, if you use the phone or desktop build."
      >
        <Input
          value={draft.url}
          onChangeText={(url) => update({ url })}
          autoCapitalize="none"
          inputMode="url"
          placeholder="http://192.168.1.10:3000"
        />
      </Field>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Field label="Icon">
            <Select
              value={draft.icon}
              options={ICONS}
              onChange={(icon) => update({ icon: icon as EmbedConfig["icon"] })}
            />
          </Field>
        </View>
        <View className="flex-1">
          <Field
            label="Opens"
            hint={
              draft.mode === "iframe"
                ? "Some servers refuse to be framed; switch to the browser if it comes up blank."
                : undefined
            }
          >
            <Select
              value={draft.mode}
              options={MODES}
              onChange={(mode) => update({ mode: mode as EmbedConfig["mode"] })}
            />
          </Field>
        </View>
      </View>

      <Field label="Id" hint="The route its view lives at: /embed/<id>">
        <Input
          value={draft.id}
          onChangeText={(id) => update({ id })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <View className="flex-row items-center gap-3">
        <Switch value={draft.enabled} onValueChange={(enabled) => update({ enabled })} />
        <Text className="text-sm text-popover-foreground">Show it in the sidebar</Text>
      </View>

      <ErrorNote error={error} />
    </Dialog>
  );
}

export default function AppsScreen() {
  const queryClient = useQueryClient();
  const embeds = useQuery({
    queryKey: ["embeds"],
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const [editing, setEditing] = useState<Editing | null>(null);

  const save = useMutation({
    mutationFn: (value: EmbedConfig[]) => api.saveEmbeds(value),
    // Seeded from what the save read back rather than invalidated: the sidebar reads this same
    // query, and a refetch it has to wait for is a nav that lags a rename by a round trip.
    onSuccess: (fresh) => {
      queryClient.setQueryData(["embeds"], fresh);
      setEditing(null);
    },
  });

  if (embeds.isError)
    return (
      <Screen>
        <ErrorNote error={embeds.error} />
      </Screen>
    );
  if (embeds.isLoading) return <Loading />;

  const list = embeds.data ?? [];

  // Every write is the whole list, so each of these is "the list, with one row changed".
  const commit = (value: EmbedConfig) =>
    save.mutate(
      editing?.index == null
        ? [...list, value]
        : list.map((embed, i) => (i === editing.index ? value : embed)),
    );

  const remove = (index: number) => save.mutate(list.filter((_, i) => i !== index));

  const toggle = (index: number, enabled: boolean) =>
    save.mutate(list.map((embed, i) => (i === index ? { ...embed, enabled } : embed)));

  return (
    <Screen>
      <Muted>
        Other web apps, given a row in the sidebar. They are not part of min-agent — a framed app is
        the other server’s own UI, running on its own.
      </Muted>
      {Platform.OS !== "web" && (
        <Muted>This build has no frame to put them in, so every app opens in the browser.</Muted>
      )}

      {/* The dialog reports its own failures; this is for the ones nothing is open to catch. */}
      {!editing && <ErrorNote error={save.error} />}

      {list.length === 0 ? (
        <Empty>No apps yet. Add one to put it in the sidebar.</Empty>
      ) : (
        <View className="gap-2">
          {list.map((embed, index) => (
            <Row
              key={embed.id}
              embed={embed}
              onOpen={() => setEditing({ index, value: embed })}
              onToggle={(enabled) => toggle(index, enabled)}
            />
          ))}
        </View>
      )}

      <View className="flex-row pb-8">
        <Button
          variant="outline"
          icon="plus"
          onPress={() => setEditing({ index: null, value: blank(list) })}
        >
          Add app
        </Button>
      </View>

      {editing && (
        <Editor
          key={editing.index ?? "new"}
          initial={editing.value}
          existing={editing.index !== null}
          busy={save.isPending}
          error={save.error}
          onCancel={() => {
            save.reset();
            setEditing(null);
          }}
          onSave={commit}
          onRemove={() => editing.index !== null && remove(editing.index)}
        />
      )}
    </Screen>
  );
}
