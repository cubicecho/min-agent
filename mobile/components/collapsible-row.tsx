import type { ReactNode } from "react";
import * as React from "react";
import { Platform, Text, View } from "react-native";
import { CollapsibleTrigger } from "@/components/collapsible";
import { LIST_ITEM_CLASS, ListItemText, rowFillClass } from "@/components/list-item";
import { cn, type SlotNode } from "@/lib/utils";

type CollapsibleRowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Whatever the row is wearing: a status, a kind, a state. Drawn before the title. */
  badgesSlot?: SlotNode | undefined;
  /** The grey line of facts beside the title — a name, a time, a count. */
  meta?: ReactNode | undefined;
  /** Two clipped lines of what the thing said, drawn under the title whether open or not. */
  description?: ReactNode | undefined;
  /** Buttons, outside the collapsible: a row is opened by its heading and acted on by these. */
  actionSlot?: SlotNode | undefined;
  /** What the row opens onto. */
  contentSlot?: SlotNode | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
};

/**
 * One row in a list of things you can open: a run, a task, an archived record. It is a
 * `ListItem` that opens — the same box, words and hover as the rows beside it that do not — and
 * the opening is `Collapsible`'s. Like `ListItem` it draws no surface: the list, card or section
 * around it owns the border.
 *
 * The whole heading is one `CollapsibleTrigger`, and `actionSlot` sits outside it, because a
 * control nested in a button is invalid HTML and cannot be pressed. Open is controlled, since a
 * row is often opened from somewhere else, such as a deep link.
 */
export function CollapsibleRow({
  open,
  onOpenChange,
  title,
  badgesSlot,
  meta,
  description,
  actionSlot,
  contentSlot,
  className,
  contentClassName,
}: CollapsibleRowProps) {
  const contentId = React.useId();
  const isOpen = open && Boolean(contentSlot);

  const heading = (
    <View className="min-w-0 flex-row flex-wrap items-center gap-2">
      {badgesSlot}
      <Text
        testID="collapsible-row-title"
        className={cn(
          "min-w-0 shrink font-semibold text-foreground text-sm leading-snug",
          // `truncate` is the ellipsis on the web; on device it is `numberOfLines`, which is
          // what `line-clamp-1` becomes and what `truncate` does not.
          Platform.select({ web: "truncate", default: "line-clamp-1" }),
        )}
      >
        {title}
      </Text>
      {/* Quieter than the title, as ListItem's meta is: left bare, a string took the title's
          semibold and "atlas 12 tools" read as one name. A node keeps its own look. */}
      {typeof meta === "string" || typeof meta === "number" ? (
        <Text
          testID="collapsible-row-meta"
          className="shrink-0 font-normal text-foreground/60 text-xs tabular-nums"
        >
          {meta}
        </Text>
      ) : (
        meta
      )}
    </View>
  );

  return (
    <View testID="collapsible-row" className={cn("min-w-0", className)}>
      <View
        testID="collapsible-row-heading"
        className={cn(LIST_ITEM_CLASS, rowFillClass(false, true))}
      >
        <CollapsibleTrigger
          testID="collapsible-row-trigger"
          open={open}
          onPress={() => onOpenChange(!open)}
          // Only while it is open: the body is unmounted when closed, which is what keeps a list
          // of two hundred rows cheap.
          controls={isOpen ? contentId : undefined}
          contentSlot={<ListItemText title={heading} description={description} />}
        />
        {actionSlot ? (
          <View testID="collapsible-row-action" className="shrink-0 flex-row items-center gap-1">
            {actionSlot}
          </View>
        ) : null}
      </View>

      {isOpen ? (
        <View
          testID="collapsible-row-content"
          nativeID={contentId}
          // Under the heading at the row's own inset, so it reads as this row's and not the next.
          className={cn("min-w-0 gap-2 px-3 pb-2", contentClassName)}
        >
          {contentSlot}
        </View>
      ) : null}
    </View>
  );
}

/** @deprecated Use `CollapsibleRow`; this name goes in the next release. */
export const DisclosureRow = CollapsibleRow;
