import { messageOf } from "@shared/errors.ts";
import { type EmbedConfig, embedTitle } from "@shared/types.ts";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Linking, Platform, View } from "react-native";
import { ActionButton } from "@/components/action-button.tsx";
import { useAppForm } from "@/components/app/app-form.tsx";
import { ExternalLink, LayoutGrid } from "@/components/app/app-icons";
import { EMBED_ICON } from "@/components/apps/embed-icon.ts";
import { EmbedIconField } from "@/components/apps/embed-icon-picker.tsx";
import { ConfirmButton } from "@/components/confirm-button.tsx";
import { DialogLayout } from "@/components/dialog-layout.tsx";
import { ListItem } from "@/components/list-item.tsx";
import { EmptyState } from "@/components/page.tsx";
import { QueryState } from "@/components/query-state.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button.tsx";
import { Form } from "@/components/ui/form.tsx";
import { ChevronRight, Plus, Trash2 } from "@/components/ui/icons";
import { api } from "@/lib/client.ts";
import { EMBEDS_STALE_TIME } from "@/lib/embeds.ts";
import { queryKeys } from "@/lib/queries.ts";
import { useReportDirty } from "./dirty.tsx";
import { TextField } from "./fields.tsx";
import { PanelBody } from "./panel-body.tsx";
import { SettingsSection as Section } from "./settings-section.tsx";

/**
 * The other apps that get a row in the sidebar — a task server, a kanban board.
 *
 * The panel is a list and the editing happens in a dialog over it, because the list is the
 * thing you come here to read: which apps exist, which are on, where they point. Six form
 * fields per row said none of that until you had scrolled past them.
 *
 * Every edit goes through the dialog and its Save, the switch that shows or hides an app
 * included. The mutation replaces the whole set — an embed's id is the route its view lives
 * at, so the server takes the list rather than a patch.
 */

const MODES = [
  { label: "In a frame", value: "iframe" },
  { label: "In the browser", value: "external" },
];

const blank = (taken: EmbedConfig[]): EmbedConfig => {
  // Ids are unique or the save is refused, and the id of the row you just deleted is the one
  // the next `app-N` would land on.
  let n = taken.length + 1;
  while (taken.some((embed) => embed.id === `app-${n}`)) {
    n += 1;
  }
  return { id: `app-${n}`, label: "", url: "", icon: "grid", mode: "iframe", enabled: true };
};

/** Which row the dialog is editing: an index into the list, or a new row at the end. */
type Editing = { index: number | null; value: EmbedConfig };

/** One line of the list: what it is, where it points, and whether it is on. */
function Row({ embed, onOpen }: { embed: EmbedConfig; onOpen: () => void }) {
  const Glyph = EMBED_ICON[embed.icon];
  return (
    <ListItem
      className="border border-border bg-card"
      leadingSlot={
        <Glyph
          className={embed.enabled ? "size-4 text-foreground" : "size-4 text-muted-foreground"}
        />
      }
      title={embedTitle(embed)}
      titleClassName={embed.enabled ? undefined : "text-muted-foreground"}
      description={embed.url || "No address yet"}
      meta={
        <>
          {embed.mode === "external" ? <Badge variant="outline">browser</Badge> : null}
          {embed.enabled ? null : <Badge variant="secondary">hidden</Badge>}
        </>
      }
      actionSlot={<ChevronRight className="size-4 text-muted-foreground" />}
      onPress={onOpen}
    />
  );
}

/**
 * The create/edit form. It owns its own draft so typing does not re-render the list behind
 * it, and it is seeded afresh every time the dialog opens — `key` on the caller — rather than
 * syncing an effect against the row it was opened on.
 *
 * `visible` is the panel's, not the dialog's: a dialog is drawn outside the tree it is
 * written in, so hiding the panel behind another tab would leave this floating over whatever
 * you switched to. It is hidden with the panel and kept mounted, so the half-typed row is
 * still here when you come back.
 */
function Editor({
  visible,
  initial,
  existing,
  error,
  onCancel,
  onSave,
  onRemove,
}: {
  visible: boolean;
  initial: EmbedConfig;
  existing: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (value: EmbedConfig) => Promise<unknown>;
  onRemove: () => void;
}) {
  const form = useAppForm({
    defaultValues: initial,
    // A refused save is reported by the mutation, under the fields; the form only has to
    // stay open with what was typed.
    onSubmit: ({ value }) => onSave(value).catch(() => {}),
  });

  const dirty = useStore(form.store, (state) => state.isDefaultValue === false);
  // Puts a dot on the tab while there is a row typed and not yet saved behind it.
  useReportDirty("apps", dirty);

  const name = embedTitle(initial);

  return (
    <form.AppForm>
      <DialogLayout
        open={visible}
        onOpenChange={(open) => {
          const isClosing = open === false;
          if (isClosing) {
            onCancel();
          }
        }}
        title={existing ? name : "Add an app"}
        description="A web app given a row in the sidebar."
        hasUnsavedChanges={() => form.state.isDefaultValue === false}
        footerSlot={
          <View className="flex-row items-center gap-1">
            {existing ? (
              <ConfirmButton
                variant="ghost"
                size="icon"
                label={`Remove ${name}`}
                title={`Remove ${name}?`}
                description="Its row leaves the sidebar. The app itself is not touched."
                confirmLabel="Remove"
                onConfirm={onRemove}
                iconSlot={<Trash2 className="size-4" />}
              />
            ) : null}
            <form.Subscribe selector={(state) => state.values.url}>
              {(url) => (
                <ActionButton
                  variant="ghost"
                  size="icon"
                  label="Open in the browser"
                  disabled={!url}
                  onPress={() => void Linking.openURL(url)}
                  iconSlot={<ExternalLink className="size-4" />}
                />
              )}
            </form.Subscribe>
          </View>
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" onPress={close} content="Cancel" />
            <form.SubmitButton isEdit={existing} createLabel="Add app" editLabel="Save" />
          </>
        )}
        contentSlot={
          <Form className="gap-4">
            <form.AppField name="label">
              {() => (
                <TextField label="Label" placeholder="Kanban" autoFocus={existing === false} />
              )}
            </form.AppField>

            <form.AppField
              name="url"
              validators={{
                onChange: ({ value }) =>
                  value.trim() === "" ? "An app needs an address." : undefined,
              }}
            >
              {() => (
                <TextField
                  label="URL"
                  required
                  description="An address every device that opens min-agent can reach — a LAN address, not localhost, if you use the phone or desktop build."
                  inputMode="url"
                  placeholder="http://192.168.1.10:3000"
                />
              )}
            </form.AppField>

            <form.AppField name="icon">
              {() => (
                <EmbedIconField
                  label="Icon"
                  description="What the sidebar row shows next to the label."
                />
              )}
            </form.AppField>

            <form.Subscribe selector={(state) => state.values.mode}>
              {(mode) => (
                <form.AppField name="mode">
                  {(field) => (
                    <field.OptionSelectField
                      label="Opens"
                      options={MODES}
                      description={
                        mode === "iframe"
                          ? "Some servers refuse to be framed; switch to the browser if it comes up blank."
                          : undefined
                      }
                    />
                  )}
                </form.AppField>
              )}
            </form.Subscribe>

            <form.AppField name="id">
              {() => (
                <TextField label="Id" description="The route its view lives at: /embed/<id>" />
              )}
            </form.AppField>

            <form.AppField name="enabled">
              {(field) => <field.SwitchField label="Show it in the sidebar" />}
            </form.AppField>

            {error ? (
              <Alert variant="destructive" title="Not saved" description={messageOf(error)} />
            ) : null}
          </Form>
        }
      />
    </form.AppForm>
  );
}

export function AppsPanel({ active = true }: { active?: boolean }) {
  const queryClient = useQueryClient();
  const embeds = useQuery({
    queryKey: queryKeys.embeds,
    queryFn: api.embeds,
    staleTime: EMBEDS_STALE_TIME,
  });
  const [editing, setEditing] = useState<Editing | null>(null);

  const save = useMutation({
    mutationFn: (value: EmbedConfig[]) => api.saveEmbeds(value),
    // Seeded from what the save read back rather than invalidated: the sidebar reads this same
    // query, and a refetch it has to wait for is a nav that lags a rename by a round trip.
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKeys.embeds, fresh);
      setEditing(null);
    },
  });

  const list = embeds.data ?? [];

  // Every write is the whole list, so each of these is "the list, with one row changed".
  const commit = (value: EmbedConfig) =>
    save.mutateAsync(
      editing?.index == null
        ? [...list, value]
        : list.map((embed, i) => (i === editing.index ? value : embed)),
    );

  const remove = (index: number) => save.mutate(list.filter((_, i) => i !== index));

  const add = (
    <Button
      variant="outline"
      onPress={() => setEditing({ index: null, value: blank(list) })}
      iconSlot={<Plus className="size-4" />}
      content="Add app"
    />
  );

  return (
    <PanelBody
      content={
        <>
          <Section
            title="Apps"
            description={
              Platform.OS === "web"
                ? "Other web apps, given a row in the sidebar. They are not part of min-agent — a framed app is the other server’s own UI, running on its own."
                : "Other web apps, given a row in the sidebar. They are not part of min-agent, and this build has no frame to put them in, so every app opens in the browser."
            }
            actionSlot={embeds.isSuccess ? add : undefined}
            contentClassName="flex flex-col gap-2"
            contentSlot={
              <>
                {/* The dialog reports its own failures; this is for the ones nothing is open to catch. */}
                {!editing && save.error ? (
                  <Alert
                    variant="destructive"
                    title="Not saved"
                    description={messageOf(save.error)}
                  />
                ) : null}
                <QueryState
                  query={embeds}
                  what="apps"
                  count={list.length}
                  emptySlot={
                    <EmptyState
                      icon={LayoutGrid}
                      title="No apps yet"
                      description="Add one to put it in the sidebar."
                    />
                  }
                />
                {list.map((embed, index) => (
                  <Row
                    key={embed.id}
                    embed={embed}
                    onOpen={() => setEditing({ index, value: embed })}
                  />
                ))}
              </>
            }
          />

          {editing ? (
            <Editor
              key={editing.index ?? "new"}
              visible={active}
              initial={editing.value}
              existing={editing.index !== null}
              error={save.error}
              onCancel={() => {
                save.reset();
                setEditing(null);
              }}
              onSave={commit}
              onRemove={() => editing.index !== null && remove(editing.index)}
            />
          ) : null}
        </>
      }
    />
  );
}
