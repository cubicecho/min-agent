import { matchSessions, SEARCH_AFTER } from "@shared/client/sessions.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Empty, ErrorNote, Input, Loading, Muted, Screen } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { cn } from "@/lib/utils.ts";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

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

  const newChat = useMutation({
    mutationFn: api.createSession,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      go(created.id);
    },
  });

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

  function commit(id: string, title: string) {
    setEditing(null);
    const trimmed = title.trim();
    const current = all.find((item) => item.id === id)?.title;
    if (trimmed && trimmed !== current) rename.mutate({ id, title: trimmed });
  }

  return {
    sessions,
    all,
    shown: matchSessions(all, query),
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

/** Search box, shown only once there are enough chats for scanning to be the slower way. */
function Search({ list, className }: { list: List; className?: string }) {
  if (list.all.length <= SEARCH_AFTER) return null;
  return (
    <Input
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

function NoMatch({ list }: { list: List }) {
  if (!list.all.length || list.shown.length) return null;
  return <Muted className="px-3 py-2">No session matches “{list.query}”.</Muted>;
}

/** The right-hand panel on a wide screen: the chat keeps the room, this keeps 18rem. */
export function SessionsPanel({ activeId }: { activeId?: string }) {
  const list = useSessions(activeId);
  const { sessions, shown, newChat, open } = list;

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
            <Muted>Check the server address under Settings.</Muted>
          </View>
        ) : null}

        {sessions.data?.length === 0 ? <Muted className="px-3 py-2">No sessions yet.</Muted> : null}
        <NoMatch list={list} />

        {shown.map((item) =>
          list.editing === item.id ? (
            <View key={item.id} className="px-1 py-1">
              <RenameField initial={item.title} onCommit={(title) => list.commit(item.id, title)} />
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
                <Muted>{when(item.updatedAt)}</Muted>
              </Pressable>
              <View className="absolute right-1 top-1.5">
                <RowActions list={list} id={item.id} title={item.title} />
              </View>
            </View>
          ),
        )}
      </ScrollView>
    </View>
  );
}

/** The whole of the Chats screen on a narrow one, where there is no room to sit beside. */
export function SessionsScreen() {
  const list = useSessions();
  const { sessions, shown, newChat, open } = list;

  if (sessions.isLoading) return <Loading />;

  return (
    <Screen>
      <Button icon="plus" busy={newChat.isPending} onPress={() => newChat.mutate()}>
        New chat
      </Button>

      <ErrorNote error={sessions.error} />
      {sessions.isError && (
        <Muted>
          Check the server address under Settings — nothing else on this screen will work until it
          resolves.
        </Muted>
      )}

      <Search list={list} />

      {sessions.data?.length === 0 && <Empty>No sessions yet.</Empty>}
      <NoMatch list={list} />

      <View className="overflow-hidden rounded-xl border border-border">
        {shown.map((item, index) => (
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
                  <Muted>{when(item.updatedAt)}</Muted>
                </Pressable>
                <View className="pr-2">
                  <RowActions list={list} id={item.id} title={item.title} />
                </View>
              </>
            )}
          </View>
        ))}
      </View>
    </Screen>
  );
}
