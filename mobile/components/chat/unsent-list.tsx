import { Delivery, type Unsent } from "@shared/client/turns.ts";
import { Text, View } from "react-native";
import { MUTED } from "@/components/chat/token-readouts.tsx";
import { List } from "@/components/list.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Pencil, X } from "@/components/ui/icons";

/** What an unsent message says it is waiting for, by how it is to go. */
const UNSENT_FOR: Record<Delivery, string> = {
  [Delivery.Steer]: "Joins this turn after its current step",
  [Delivery.Queue]: "Sends as the next turn",
};

/**
 * What was typed while the chat's turn ran and has not gone yet, above the box it was typed in.
 *
 * A message on its way into the running turn has left already and cannot be called back. A
 * queued one has not, so it can be taken back into the box or thrown away.
 */
export function UnsentList({
  unsent,
  onPullBack,
  onDiscard,
}: {
  /** Oldest first. Nothing is drawn while it is empty. */
  unsent: readonly Unsent[];
  /** Takes a queued message back into the box. */
  onPullBack: (id: string) => void;
  /** Throws a queued message away. */
  onDiscard: (id: string) => void;
}) {
  return (
    <List
      label="Not sent yet"
      className="rounded-md border border-border"
      contentSlot={unsent.map((item) => (
        <View key={item.id} className="flex-row items-center gap-2">
          <View className="flex-1 gap-0.5">
            <Text numberOfLines={2} className="text-foreground text-sm">
              {item.text}
            </Text>
            <Text className={MUTED}>{UNSENT_FOR[item.delivery]}</Text>
          </View>
          {item.delivery === Delivery.Queue ? (
            <>
              <Button
                variant="outline"
                size="icon-xs"
                aria-label="Edit the queued message"
                onPress={() => onPullBack(item.id)}
                iconSlot={<Pencil aria-hidden className="size-3.5" />}
              />
              <Button
                variant="outline"
                size="icon-xs"
                aria-label="Remove the queued message"
                onPress={() => onDiscard(item.id)}
                iconSlot={<X aria-hidden className="size-3.5" />}
              />
            </>
          ) : null}
        </View>
      ))}
    />
  );
}
