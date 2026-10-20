import type { ReactNode } from "react";
import * as React from "react";
import { Platform, Pressable, Text } from "react-native";
import { ChevronRight } from "@/components/ui/icons";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemTitle,
} from "@/components/ui/item";
import { cn, type SlotNode } from "@/lib/utils";

type DisclosureRowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Whatever the row is wearing: a status, a kind, a state. Drawn before the title. */
  badgesSlot?: SlotNode | undefined;
  /** The grey line of facts beside the title — a name, a time, a count. */
  meta?: ReactNode | undefined;
  /** Two clipped lines of what the thing said, drawn under the title whether open or not. */
  description?: ReactNode | undefined;
  /** Buttons, outside the disclosure: a row is opened by its heading and acted on by these. */
  actionSlot?: SlotNode | undefined;
  /** What the row opens onto. */
  contentSlot?: SlotNode | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
};

/**
 * One row in a list of things you can open: a run, a task, an archived record. The row is `Item`,
 * so it lines up with rows that do not open, and the opening is `Disclosure`'s.
 *
 * The whole heading is one button carrying `aria-expanded`, and the chevron turns off the same
 * boolean. `actionSlot` sits outside that button, because a control nested in a button is invalid
 * HTML and cannot be pressed. Open is controlled, since a row is often opened from somewhere else,
 * such as a deep link.
 */
export function DisclosureRow({
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
}: DisclosureRowProps) {
  const contentId = React.useId();
  const isOpen = open && Boolean(contentSlot);

  return (
    <Item testID="disclosure-row" variant="outline" className={cn("items-start", className)}>
      <Pressable
        testID="disclosure-row-trigger"
        role="button"
        aria-expanded={open}
        accessibilityState={{ expanded: open }}
        // Web only, and only while it is open: React Native has no `aria-controls`, and pointing it
        // at an id that is not in the document is a broken reference rather than a hint — the
        // body is unmounted when closed, which is what keeps a list of two hundred rows cheap.
        {...(Platform.OS === "web" && isOpen ? { "aria-controls": contentId } : {})}
        onPress={() => onOpenChange(!open)}
        className={cn(
          "min-w-0 flex-1 flex-row items-start gap-2 rounded-sm",
          Platform.select({
            web: "text-left focus-visible:bg-hover focus-visible:outline-none",
            default: undefined,
          }),
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-foreground/60",
            Platform.select({ web: "transition-transform", default: undefined }),
            open && "rotate-90",
          )}
        />
        <ItemContent className="min-w-0">
          <ItemTitle className="flex-wrap">
            {badgesSlot}
            <Text
              testID="disclosure-row-title"
              className={cn(
                "min-w-0 shrink font-semibold text-foreground text-sm leading-snug",
                // `truncate` is the ellipsis on the web; on device it is `numberOfLines`, which is
                // what `line-clamp-1` becomes and what `truncate` does not.
                Platform.select({ web: "truncate", default: "line-clamp-1" }),
              )}
            >
              {title}
            </Text>
            {meta}
          </ItemTitle>
          {description ? <ItemDescription>{description}</ItemDescription> : null}
        </ItemContent>
      </Pressable>

      {actionSlot ? <ItemActions className="gap-1">{actionSlot}</ItemActions> : null}

      {isOpen ? (
        <ItemFooter
          nativeID={contentId}
          className={cn(
            "min-w-0 flex-col items-stretch gap-2 border-foreground/10 border-t pt-3",
            contentClassName,
          )}
        >
          {contentSlot}
        </ItemFooter>
      ) : null}
    </Item>
  );
}
