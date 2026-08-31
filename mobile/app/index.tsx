import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { Button, Empty, ErrorNote, Loading, Muted, Screen } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export default function SessionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const sessions = useQuery({ queryKey: ["sessions"], queryFn: api.sessions });

  const newChat = useMutation({
    mutationFn: api.createSession,
    onSuccess: async (created) => {
      await queryClient.invalidateQueries({ queryKey: ["sessions"] });
      router.push(`/chat/${created.id}`);
    },
  });

  const remove = useMutation({
    mutationFn: api.deleteSession,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["sessions"] }),
  });

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
            <Pressable
              onPress={() => router.push(`/chat/${item.id}`)}
              className="flex-1 px-4 py-3 active:bg-accent"
            >
              <Text className="text-sm text-foreground" numberOfLines={1}>
                {item.title}
              </Text>
              <Muted>
                {item.source === "cron" ? "cron · " : ""}
                {when(item.updatedAt)}
              </Muted>
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
