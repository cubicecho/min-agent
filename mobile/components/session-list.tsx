import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, Text, View } from "react-native";
import { Button, Empty, ErrorNote, Loading, Muted, Screen } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { cn } from "@/lib/utils.ts";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

/**
 * The list takes two shapes — a panel beside the chat on a wide screen, a screen of its
 * own on a narrow one — but it is the same list either way, so the queries and the
 * mutations live here and only the arrangement differs below.
 */
function useSessions(activeId?: string) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });

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

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: async (_data, id) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      // Deleting the chat that is open would otherwise leave it on screen with nothing
      // behind it.
      if (id === activeId) router.replace("/");
    },
  });

  return { sessions, newChat, remove, open: go };
}

const subtitle = (item: { updatedAt: string }) => when(item.updatedAt);

/** The right-hand panel, as on the web app: the chat keeps the room, this keeps 18rem. */
export function SessionsPanel({ activeId }: { activeId?: string }) {
  const { sessions, newChat, remove, open } = useSessions(activeId);

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

      <ScrollView className="flex-1" contentContainerClassName="gap-0.5 px-2 pb-3">
        {sessions.isError ? (
          <View className="gap-2 px-1">
            <ErrorNote error={sessions.error} />
            <Muted>Check the server address under Settings.</Muted>
          </View>
        ) : null}

        {sessions.data?.length === 0 ? <Muted className="px-3 py-2">No sessions yet.</Muted> : null}

        {(sessions.data ?? []).map((item) => (
          <View key={item.id} className="relative">
            <Pressable
              onPress={() => open(item.id)}
              className={cn(
                "rounded-md py-2 pl-3 pr-9 active:bg-accent",
                item.id === activeId && "bg-accent",
              )}
            >
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {item.title}
              </Text>
              <Muted>{subtitle(item)}</Muted>
            </Pressable>
            <Button
              variant="ghost"
              size="icon"
              icon="trash-2"
              className="absolute right-1 top-1.5 h-7 w-7"
              onPress={() => remove.mutate(item.id)}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The whole of the Chats screen on a narrow one, where there is no room to sit beside. */
export function SessionsScreen() {
  const { sessions, newChat, remove, open } = useSessions();

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

      {sessions.data?.length === 0 && <Empty>No sessions yet.</Empty>}

      <View className="overflow-hidden rounded-xl border border-border">
        {(sessions.data ?? []).map((item, index) => (
          <View
            key={item.id}
            className={`flex-row items-center ${index > 0 ? "border-t border-border" : ""}`}
          >
            <Pressable onPress={() => open(item.id)} className="flex-1 px-4 py-3 active:bg-accent">
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {item.title}
              </Text>
              <Muted>{subtitle(item)}</Muted>
            </Pressable>
            <Button
              variant="ghost"
              size="icon"
              icon="trash-2"
              onPress={() => remove.mutate(item.id)}
            />
          </View>
        ))}
      </View>
    </Screen>
  );
}
