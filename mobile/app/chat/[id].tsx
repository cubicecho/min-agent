import { useLocalSearchParams } from "expo-router";
import { ChatsView } from "@/components/chat-view.tsx";

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChatsView sessionId={id} />;
}
