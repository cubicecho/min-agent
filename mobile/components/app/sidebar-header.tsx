import { useSidebar } from "@/components/sidebar.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Plus } from "@/components/ui/icons";
import type { SlotNode } from "@/lib/utils.ts";

export type SidebarHeaderProps = {
  /** The app's name, drawn while the sidebar is open. The folded rail has no room for it. */
  brandSlot: SlotNode;
  /** The mutation behind New chat, so the button waits while a chat is being made. */
  newChat: { isPending: boolean; mutate: () => void };
};

/**
 * The top of the sidebar: the brand over a New chat button, or, folded to the rail, the same
 * button as an icon. It reads which of the two from the `Sidebar` it is drawn in.
 */
export function SidebarHeader({ brandSlot, newChat }: SidebarHeaderProps) {
  const { collapsed } = useSidebar();

  if (collapsed) {
    return (
      <Button
        aria-label="New chat"
        size="icon-sm"
        className="self-center"
        disabled={newChat.isPending}
        onPress={() => newChat.mutate()}
        iconSlot={<Plus className="size-4" />}
      />
    );
  }

  return (
    <>
      {brandSlot}
      <Button
        size="sm"
        className="w-full gap-2"
        disabled={newChat.isPending}
        onPress={() => newChat.mutate()}
        iconSlot={<Plus className="size-4" />}
        content="New chat"
      />
    </>
  );
}
