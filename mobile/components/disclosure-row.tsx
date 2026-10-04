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
import { cn } from "@/lib/utils";

type DisclosureRowProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** Whatever the row is wearing: a status, a kind, a state. Drawn before the title. */
  badges?: ReactNode | undefined;
  /** The grey line of facts beside the title — a name, a time, a count. */
  meta?: ReactNode | undefined;
  /** Two clipped lines of what the thing said, drawn under the title whether open or not. */
  description?: ReactNode | undefined;
  /** Buttons, outside the disclosure: a row is opened by its heading and acted on by these. */
  action?: ReactNode | undefined;
  /** What the row opens onto. */
  content?: ReactNode | undefined;
  className?: string | undefined;
  contentClassName?: string | undefined;
};

/**
 * One row in a list of things you can open: a run, a task, an archived record. One source for
 * both platforms.
 *
 * The row itself is `Item`, so a row that opens and a row that does not line up down to the
 * padding. What this adds is `Disclosure`'s opening, and it is here rather than left to each app
 * because the parts of a disclosure that go wrong are the small ones:
 *
 * - **The whole heading is one button** — a `<button>` on the web, `role="button"` on device —
 *   so the row is reached by Tab and works with Space, not a chevron with a press handler, which
 *   is the version hand-written rows ship.
 * - `aria-expanded` on that button, so the state is announced rather than only drawn as a
 *   rotated chevron; and on the web `aria-controls` naming the body, while the body is there.
 * - The chevron turns off the same boolean, so there is one source of truth for open.
 * - **`action` sits outside the button.** A control nested inside a button is invalid HTML and,
 *   in practice, a delete button that cannot be pressed. Three pages of one app were laid out
 *   this way after finding that out.
 *
 * It is not a prop on `Item`: an `open`/`onOpenChange` pair there would turn every existing
 * caller's heading into a button, which is a different element and a different contract. And it
 * is not `Disclosure` itself, whose look is a section's compact muted line; this is a list row,
 * bordered, with badges and a line of facts beside the title.
 *
 * Open is controlled, because in these apps a row is often opened from somewhere else — a deep
 * link to a run, a "show the failure" button further up the page. An uncontrolled default would
 * be a convenience worth adding, not the base case.
 *
 * On a device, a string `meta`, `action` or `content` is wrapped in a `Text` by the `Item` part it
 * sits in; an element is placed as it is.
 */
export function DisclosureRow({
  open,
  onOpenChange,
  title,
  badges,
  meta,
  description,
  action,
  content,
  className,
  contentClassName,
}: DisclosureRowProps) {
  const contentId = React.useId();
  const isOpen = open && Boolean(content);

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
          "min-w-0 flex-1 flex-row items-start gap-2 rounded",
          Platform.select({
            web: "text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            default: undefined,
          }),
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "mt-0.5 size-4 shrink-0 text-muted-foreground",
            Platform.select({ web: "transition-transform", default: undefined }),
            open && "rotate-90",
          )}
        />
        <ItemContent className="min-w-0">
          <ItemTitle className="flex-wrap">
            {badges}
            <Text
              testID="disclosure-row-title"
              className={cn(
                "min-w-0 shrink font-medium text-foreground text-sm leading-snug",
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

      {action ? <ItemActions className="gap-1">{action}</ItemActions> : null}

      {isOpen ? (
        <ItemFooter
          nativeID={contentId}
          className={cn(
            "min-w-0 flex-col items-stretch gap-2 border-border border-t pt-3",
            contentClassName,
          )}
        >
          {content}
        </ItemFooter>
      ) : null}
    </Item>
  );
}
