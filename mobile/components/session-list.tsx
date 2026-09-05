import {
  type Bucket,
  groupSessions,
  matchSessions,
  SEARCH_AFTER,
} from "@shared/client/sessions.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, type TextInput, View } from "react-native";
import { SettingsLink } from "@/components/settings/link.tsx";
import { Button, Empty, ErrorNote, Input, Loading, Muted } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { useShortcut } from "@/lib/keys.ts";
import { cn } from "@/lib/utils.ts";

/**
 * How much of a timestamp a row still has to say, given the heading it is already under.
 *
 * Under Today the date is the heading, so the row only needs a clock; a week back the
 * weekday is what you actually remember; older than that the time of day means nothing and
 * the date is the whole of it.
 */
const when = (iso: string, bucket: Bucket) =>
  new Date(iso).toLocaleString(
    undefined,
    bucket === "earlier"
      ? { month: "short", day: "numeric" }
      : bucket === "week"
        ? { weekday: "short", hour: "2-digit", minute: "2-digit" }
        : { hour: "2-digit", minute: "2-digit" },
  );

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
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      go(created.id);
    },
  });
}

/** How long a primed delete stays primed before it forgets it was ever asked. */
const ARMED_FOR = 5000;

/**
 * The list takes two shapes — a panel beside the chat on a wide screen, a screen of its
 * own on a narrow one — but it is the same list either way, so the queries, the mutations
 * and the row state live here and only the arrangement differs below.
 */
function useSessions(activeId?: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });

  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  // A row left primed and forgotten is a delete waiting to happen on the next stray tap.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(null), ARMED_FOR);
    return () => clearTimeout(timer);
  }, [armed]);

  // Coming from the list, a chat is somewhere to go back from. Switching between chats in
  // the side panel is not, and pushing there would pile the whole afternoon onto the stack.
  const go = (id: string) =>
    activeId ? router.replace(`/chat/${id}`) : router.push(`/chat/${id}`);

  const newChat = useNewChat(go);

  const rename = useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) => api.renameSession(id, title),
    onSuccess: async (_data, { id }) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // The drawer header above the chat reads its title from the session, not from this list.
      await queryClient.invalidateQueries({ queryKey: ["session", id] });
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // Deleting the chat that is open would otherwise leave it on screen with nothing
      // behind it.
      if (id === activeId) router.replace("/");
    },
  });

  const all = sessions.data ?? [];
  const shown = matchSessions(all, query);

  function commit(id: string, title: string) {
    setEditing(null);
    const trimmed = title.trim();
    const current = all.find((item) => item.id === id)?.title;
    if (trimmed && trimmed !== current) rename.mutate({ id, title: trimmed });
  }

  return {
    sessions,
    all,
    shown,
    groups: groupSessions(shown),
    query,
    setQuery,
    editing,
    setEditing,
    armed,
    setArmed,
    commit,
    newChat,
    remove,
    open: go,
  };
}

type List = ReturnType<typeof useSessions>;

/**
 * The title, while it is being edited. It owns the draft so that typing does not re-render
 * the list around it, and a ref keeps the blur that follows submitting from committing twice.
 */
function RenameField({
  initial,
  onCommit,
}: {
  initial: string;
  onCommit: (title: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    onCommit(value);
  };

  // Escape puts the old title back. `commit` ignores a title it was already holding, so
  // giving up is finishing with what we started with rather than a path of its own.
  useShortcut("escape", () => {
    setValue(initial);
    if (done.current) return;
    done.current = true;
    onCommit(initial);
  });

  return (
    <Input
      autoFocus
      value={value}
      onChangeText={setValue}
      onSubmitEditing={finish}
      onBlur={finish}
      returnKeyType="done"
      className="h-9"
    />
  );
}

/** Whether there are enough chats that reading down the list is the slower way to find one. */
const searchable = (list: List) => list.all.length > SEARCH_AFTER;

/** Search box, shown only once there are enough chats for scanning to be the slower way. */
function Search({ list, className }: { list: List; className?: string }) {
  const box = useRef<TextInput>(null);
  // Bound only while the box is on screen: a key that does nothing is worse than one that
  // was never taken, because the browser's own ⌘K would have done something.
  useShortcut("mod+k", searchable(list) ? () => box.current?.focus() : undefined);

  if (!searchable(list)) return null;
  return (
    <Input
      ref={box}
      value={list.query}
      onChangeText={list.setQuery}
      placeholder="Search sessions"
      className={cn("h-9", className)}
    />
  );
}

/** Rename and delete, the delete asking once before it happens. */
function RowActions({ list, id, title }: { list: List; id: string; title: string }) {
  if (list.armed === id) {
    return (
      <View className="flex-row items-center">
        <Button size="sm" variant="destructive" onPress={() => list.remove.mutate(id)}>
          Delete?
        </Button>
        <Button variant="ghost" size="icon" icon="x" onPress={() => list.setArmed(null)} />
      </View>
    );
  }
  return (
    <View className="flex-row items-center">
      <Button
        variant="ghost"
        size="icon"
        icon="edit-2"
        accessibilityLabel={`Rename ${title}`}
        onPress={() => list.setEditing(id)}
      />
      <Button
        variant="ghost"
        size="icon"
        icon="trash-2"
        accessibilityLabel={`Delete ${title}`}
        onPress={() => list.setArmed(id)}
      />
    </View>
  );
}

/**
 * The heading over a group. Quiet on purpose: it is a divider you read past, not a row you
 * can open, and it is repeating what the rows under it already imply.
 */
const GroupHeading = ({ children }: { children: string }) => (
  <Text className="px-3 pb-1 pt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </Text>
);

function NoMatch({ list }: { list: List }) {
  if (!list.all.length || list.shown.length) return null;
  return <Muted className="px-3 py-2">No session matches “{list.query}”.</Muted>;
}

/** The right-hand panel on a wide screen: the chat keeps the room, this keeps 18rem. */
export function SessionsPanel({ activeId }: { activeId?: string }) {
  const list = useSessions(activeId);
  const { sessions, newChat, open } = list;

  return (
    <View className="w-72 shrink-0 border-l border-border bg-sidebar">
      <View className="flex-row items-center justify-between px-3 py-3">
        <Text className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Sessions
        </Text>
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          busy={newChat.isPending}
          onPress={() => newChat.mutate()}
        >
          New
        </Button>
      </View>

      <View className="px-3">
        <Search list={list} className="mb-2" />
      </View>

      <ScrollView className="flex-1" contentContainerClassName="gap-0.5 px-2 pb-3">
        {sessions.isError ? (
          <View className="gap-2 px-1">
            <ErrorNote error={sessions.error} />
            <Muted>The server did not answer. Check the address it is being asked for.</Muted>
            <View className="flex-row">
              <SettingsLink tab="server" />
            </View>
          </View>
        ) : null}

        {sessions.data?.length === 0 ? <Muted className="px-3 py-2">No sessions yet.</Muted> : null}
        <NoMatch list={list} />

        {list.groups.map((group) => (
          <View key={group.bucket} className="gap-0.5">
            <GroupHeading>{group.label}</GroupHeading>
            {group.sessions.map((item) =>
              list.editing === item.id ? (
                <View key={item.id} className="px-1 py-1">
                  <RenameField
                    initial={item.title}
                    onCommit={(title) => list.commit(item.id, title)}
                  />
                </View>
              ) : (
                <View key={item.id} className="relative">
                  <Pressable
                    onPress={() => open(item.id)}
                    className={cn(
                      "rounded-md py-2 pl-3 pr-20 active:bg-accent",
                      item.id === activeId && "bg-accent",
                    )}
                  >
                    <Text className="text-sm text-foreground" numberOfLines={1}>
                      {item.title}
                    </Text>
                    <Muted>{when(item.updatedAt, group.bucket)}</Muted>
                  </Pressable>
                  <View className="absolute right-1 top-1.5">
                    <RowActions list={list} id={item.id} title={item.title} />
                  </View>
                </View>
              ),
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The whole of the Chats screen on a narrow one, where there is no room to sit beside. */
export function SessionsScreen() {
  const navigation = useNavigation();
  const list = useSessions();
  const { sessions, newChat, open } = list;

  /*
    The drawer owns the header, so "New chat" goes up into it beside the title — the shape
    the wide layout's panel already has, and the one place on the screen a long list cannot
    scroll it out of. It is put back on the way out because the option belongs to the route
    rather than to this component, and `chat/[id]` is a different route with a title of its
    own.
  */
  const start = newChat.mutate;
  useEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Button
          size="sm"
          variant="ghost"
          icon="plus"
          busy={newChat.isPending}
          onPress={() => start()}
        >
          New
        </Button>
      ),
    });
    return () => navigation.setOptions({ headerRight: undefined });
  }, [navigation, start, newChat.isPending]);

  if (sessions.isLoading) return <Loading />;

  return (
    <View className="flex-1 bg-background">
      {/*
        Outside the scroller rather than the first thing in it. The box is how you narrow a
        list too long to read, which is exactly the list that scrolls it off the screen the
        moment you start looking.
      */}
      {searchable(list) ? (
        <View className="border-b border-border px-4 py-3">
          <Search list={list} />
        </View>
      ) : null}

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 p-4"
        keyboardShouldPersistTaps="handled"
      >
        <ErrorNote error={sessions.error} />
        {sessions.isError && (
          <>
            <Muted>
              The server did not answer, and nothing else on this screen will work until it does.
            </Muted>
            <View className="flex-row">
              <SettingsLink tab="server" />
            </View>
          </>
        )}

        {sessions.data?.length === 0 && <Empty>No sessions yet.</Empty>}
        <NoMatch list={list} />

        {list.groups.map((group) => (
          // A card per group rather than one card with headings inside it: the heading belongs
          // to the rows under it, and a border drawn around both says so.
          <View key={group.bucket}>
            <GroupHeading>{group.label}</GroupHeading>
            <View className="overflow-hidden rounded-xl border border-border">
              {group.sessions.map((item, index) => (
                <View
                  key={item.id}
                  className={`flex-row items-center ${index > 0 ? "border-t border-border" : ""}`}
                >
                  {list.editing === item.id ? (
                    <View className="flex-1 px-3 py-2">
                      <RenameField
                        initial={item.title}
                        onCommit={(title) => list.commit(item.id, title)}
                      />
                    </View>
                  ) : (
                    <>
                      <Pressable
                        onPress={() => open(item.id)}
                        className="flex-1 px-4 py-3 active:bg-accent"
                      >
                        <Text className="text-sm text-foreground" numberOfLines={1}>
                          {item.title}
                        </Text>
                        <Muted>{when(item.updatedAt, group.bucket)}</Muted>
                      </Pressable>
                      <View className="pr-2">
                        <RowActions list={list} id={item.id} title={item.title} />
                      </View>
                    </>
                  )}
                </View>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
