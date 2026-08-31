import { ChatsView } from "@/components/chat-view.tsx";

/**
 * Wide, this is the whole chats view with nothing open yet; narrow, it is just the list.
 * Either shape is decided inside `ChatsView`, which `chat/[id]` renders too.
 */
export default function ChatsScreen() {
  return <ChatsView />;
}
