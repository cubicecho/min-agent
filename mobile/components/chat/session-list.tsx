import { type Bucket, groupSessions, matchSessions } from "@shared/client/sessions.ts";
import { SESSION_LIST_DEFAULTS } from "@shared/defaults.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View } from "react-native";
import { ActionButton } from "@/components/action-button.tsx";
import { useAppForm } from "@/components/app/app-form.tsx";
import { MessageSquare } from "@/components/app/app-icons";
import { ConfirmButton } from "@/components/confirm-button.tsx";
import { ListItem } from "@/components/list-item.tsx";
import { EmptyState } from "@/components/page.tsx";
import { PageLayout } from "@/components/page-layout.tsx";
import { QueryState } from "@/components/query-state.tsx";
import { Section } from "@/components/section.tsx";
import { SettingsLink } from "@/components/settings/link.tsx";
import { Sidebar, SidebarSection } from "@/components/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Form } from "@/components/ui/form.tsx";
import { FormDialog, FormDialogFooter } from "@/components/ui/form-dialog.tsx";
import { Pencil, Plus, Trash2 } from "@/components/ui/icons";
import type { InputHandle } from "@/components/ui/input";
import { SearchInput } from "@/components/ui/search-input";
import { api } from "@/lib/client.ts";
import { useShortcut } from "@/lib/keys.ts";
import { invalidateSession, queryKeys } from "@/lib/queries.ts";
import { cn } from "@/lib/utils.ts";

/**
 * How much of a timestamp a row still has to say, given the heading it is already under.
 *
 * Under Today the date is the heading, so the row only needs a clock; a week back the
 * weekday is what you actually remember; older than that the time of day means nothing and
 * the date is the whole of it.
 */
const TIME_FORMAT_BY_BUCKET: Record<Bucket, Intl.DateTimeFormatOptions> = {
  today: { hour: "2-digit", minute: "2-digit" },
  yesterday: { hour: "2-digit", minute: "2-digit" },
  week: { weekday: "short", hour: "2-digit", minute: "2-digit" },
  earlier: { month: "short", day: "numeric" },
};

const when = (iso: string, bucket: Bucket) =>
  new Date(iso).toLocaleString(undefined, TIME_FORMAT_BY_BUCKET[bucket]);

/**
 * Starting a chat and landing in it.
 *
 * Split out of the list because the sidebar starts one too — it is what ⌘N is bound to, and
 * the sidebar is the one thing on screen on every route — and both want the list behind them
 * to be right by the time the new chat is open.
 */
export function useNewChat(go: (id: string) => void) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createSession,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      go(created.id);
    },
  });
}

/**
 * The list takes two shapes — a panel beside the chat on a wide screen, a screen of its
 * own on a narrow one — but it is the same list either way, so the queries, the mutations
 * and the row state live here and only the arrangement differs below.
 */
function useSessions(activeId?: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: queryKeys.sessions, queryFn: api.sessions });

  const [query, setQuery] = useState("");
  /** The chat whose rename dialog is open. One dialog for the list, not one per row. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);

  // Coming from the list, a chat is somewhere to go back from. Switching between chats in
  // the side panel is not, and pushing there would pile the whole afternoon onto the stack.
  const go = (id: string) =>
    activeId ? router.replace(`/chat/${id}`) : router.push(`/chat/${id}`);

  const newChat = useNewChat(go);

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameSession(id, title),
    onSuccess: async (_data, { id }) => {
      // Both: the header above the chat reads its title from the session, not from this list.
      await invalidateSession(queryClient, id);
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
      // Deleting the chat that is open would otherwise leave it on screen with nothing
      // behind it.
      if (id === activeId) {
        router.replace("/");
      }
    },
  });

  const all = sessions.data ?? [];
  const shown = matchSessions(all, query);

  return {
    sessions,
    all,
    shown,
    groups: groupSessions(shown),
    query,
    setQuery,
    renaming,
    setRenaming,
    rename,
    newChat,
    remove,
    open: go,
  };
}

type List = ReturnType<typeof useSessions>;

/**
 * Renaming a chat, as a form of its own: the title is typed, then saved or cancelled, rather
 * than edited in the row and committed by whatever happened to take the focus away.
 *
 * Mounted only while a chat is being renamed and keyed on it, so the field starts from that
 * chat's title each time rather than from whatever the last one left behind.
 */
function RenameDialog({ list }: { list: List }) {
  const target = list.renaming;
  if (!target) {
    return null;
  }
  return <RenameForm key={target.id} list={list} id={target.id} title={target.title} />;
}

function RenameForm({ list, id, title }: { list: List; id: string; title: string }) {
  const close = () => list.setRenaming(null);
  const form = useAppForm({
    defaultValues: { title },
    onSubmit: async ({ value }) => {
      const trimmed = value.title.trim();
      // A title that did not change, or was emptied, is not a rename.
      if (trimmed && trimmed !== title) {
        await list.rename.mutateAsync({ id, title: trimmed });
      }
      close();
    },
  });

  return (
    <FormDialog
      open
      onOpenChange={(open) => {
        const isClosing = open === false;
        if (isClosing) {
          close();
        }
      }}
      title="Rename chat"
    >
      <form.AppForm>
        <Form>
          <form.AppField name="title">
            {(field) => <field.InputField label="Title" autoFocus />}
          </form.AppField>
          <FormDialogFooter onCancel={close} error={list.rename.error?.message ?? null}>
            <form.SubmitButton isEdit editLabel="Rename" savingLabel="Renaming…" />
          </FormDialogFooter>
        </Form>
      </form.AppForm>
    </FormDialog>
  );
}

/** Whether there are enough chats that reading down the list is the slower way to find one. */
const searchable = (list: List) => list.all.length > SESSION_LIST_DEFAULTS.searchAfter;

/** Search box, shown only once there are enough chats for scanning to be the slower way. */
function Search({ list }: { list: List }) {
  const box = useRef<InputHandle>(null);
  // Bound only while the box is on screen: a key that does nothing is worse than one that
  // was never taken, because the browser's own ⌘K would have done something.
  useShortcut("mod+k", searchable(list) ? () => box.current?.focus() : undefined);

  const isShortList = searchable(list) === false;
  if (isShortList) {
    return null;
  }
  return (
    <SearchInput
      ref={box}
      label="Search sessions"
      value={list.query}
      onChangeText={list.setQuery}
      placeholder="Search sessions"
    />
  );
}

/** Rename and delete, the delete asking once before it happens. */
function RowActions({ list, id, title }: { list: List; id: string; title: string }) {
  return (
    <View className="flex-row items-center">
      <ActionButton
        variant="ghost"
        size="icon-sm"
        label={`Rename ${title}`}
        onPress={() => list.setRenaming({ id, title })}
        iconSlot={<Pencil aria-hidden className="size-4" />}
      />
      <ConfirmButton
        variant="ghost"
        size="icon-sm"
        label={`Delete ${title}`}
        title="Delete this chat?"
        description={`“${title}” and everything said in it will be gone. This cannot be undone.`}
        onConfirm={() => list.remove.mutate(id)}
        iconSlot={<Trash2 aria-hidden className="size-4" />}
      />
    </View>
  );
}

/** The button that starts a chat, in both arrangements. */
function NewChatButton({ list }: { list: List }) {
  const { newChat } = list;
  return (
    <Button
      size="sm"
      variant="ghost"
      loading={newChat.isPending}
      onPress={() => newChat.mutate()}
      iconSlot={<Plus aria-hidden className="size-4" />}
      content="New"
    />
  );
}

/**
 * Loading, failed, empty and nothing-matched — the states the list can be in instead of
 * being a list. A failure carries the way out with it: the usual cause is the address the
 * app is asking, and that is one settings tab away.
 */
function ListState({ list, compact }: { list: List; compact?: boolean }) {
  const { sessions } = list;
  return (
    <>
      <QueryState
        query={sessions}
        what="sessions"
        count={list.all.length}
        compact={compact}
        emptySlot={
          compact ? (
            <EmptyState compact title="No sessions yet." />
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No sessions yet"
              description="Start a chat and it will be listed here."
              actionSlot={<NewChatButton list={list} />}
            />
          )
        }
      />
      {sessions.isError ? (
        <View className="flex-row px-1 pt-2">
          <SettingsLink tab="server" />
        </View>
      ) : null}
      {list.all.length && !list.shown.length ? (
        <EmptyState compact title={`No session matches “${list.query}”.`} />
      ) : null}
    </>
  );
}

/** One chat, as a row. The same row in both arrangements; only the surface differs. */
function SessionRow({
  list,
  item,
  bucket,
  active,
  className,
}: {
  list: List;
  item: List["shown"][number];
  bucket: Bucket;
  active?: boolean;
  className?: string;
}) {
  return (
    <ListItem
      title={item.title}
      description={when(item.updatedAt, bucket)}
      onPress={() => list.open(item.id)}
      actionSlot={<RowActions list={list} id={item.id} title={item.title} />}
      className={cn(active && "bg-sidebar-accent", className)}
    />
  );
}

/** The right-hand panel on a wide screen: the chat keeps the room, this keeps its rail. */
export function SessionsPanel({ activeId }: { activeId?: string }) {
  const list = useSessions(activeId);

  return (
    <>
      <Sidebar
        side="end"
        label="Sessions"
        // Wider than the rail's default: a row here is a title and two buttons, not a link.
        className="w-80"
        headerSlot={<Search list={list} />}
        contentSlot={
          <>
            <SidebarSection
              title="Sessions"
              level={2}
              actionSlot={<NewChatButton list={list} />}
              status={<ListState list={list} compact />}
            />
            {list.groups.map((group) => (
              <SidebarSection
                key={group.bucket}
                title={group.label}
                level={3}
                contentSlot={group.sessions.map((item) => (
                  <SessionRow
                    key={item.id}
                    list={list}
                    item={item}
                    bucket={group.bucket}
                    active={item.id === activeId}
                    className="px-2 py-1.5"
                  />
                ))}
              />
            ))}
          </>
        }
      />
      <RenameDialog list={list} />
    </>
  );
}

/** The whole of the Chats screen on a narrow one, where there is no room to sit beside. */
export function SessionsScreen() {
  const list = useSessions();

  return (
    <>
      <PageLayout
        title="Chats"
        // In the header rather than in the list: it is the one place on the screen a long list
        // cannot scroll it out of. The search box is there for the same reason — it is how you
        // narrow a list too long to read, which is exactly the list that would scroll it away.
        actionSlot={<NewChatButton list={list} />}
        headerContentSlot={searchable(list) ? <Search list={list} /> : undefined}
        contentSlot={
          <View className="gap-4 pb-4">
            <ListState list={list} />
            {list.groups.map((group) => (
              // A card per group rather than one card with headings inside it: the heading
              // belongs to the rows under it, and a border drawn around both says so.
              <Section
                key={group.bucket}
                title={group.label}
                level={2}
                contentSlot={
                  <View className="overflow-hidden rounded-xl border border-border">
                    {group.sessions.map((item, index) => (
                      <SessionRow
                        key={item.id}
                        list={list}
                        item={item}
                        bucket={group.bucket}
                        className={cn("rounded-none", index > 0 && "border-border border-t")}
                      />
                    ))}
                  </View>
                }
              />
            ))}
          </View>
        }
      />
      <RenameDialog list={list} />
    </>
  );
}
