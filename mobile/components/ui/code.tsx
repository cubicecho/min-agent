import type { ReactNode } from "react";
import { Platform, ScrollView, Text, View } from "react-native";
import { cn, type SlotNode } from "@/lib/utils";

export function Code({
  className,
  children,
}: {
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Text
      className={cn(
        "rounded bg-foreground/10 px-1 py-0.5 font-mono text-xs text-foreground",
        className,
      )}
    >
      {children}
    </Text>
  );
}

/** The heights a block may be capped at: ten, fifteen and twenty-four rem. */
const MAX_HEIGHTS = {
  sm: "max-h-40",
  md: "max-h-60",
  lg: "max-h-96",
} as const;

/** The block's type, which is `Code`'s: the two are one family and should not drift apart. */
const TEXT = "font-mono text-xs text-foreground";

export type CodeBlockProps = {
  /**
   * The text, drawn as written: its newlines and its indentation are kept. A string rather than
   * a node, because whitespace is the one thing a block of code cannot have rearranged, and a
   * node would let a caller pass markup that is not preformatted at all.
   */
  content: string;
  /**
   * The block's far end, at the top: a `CopyButton`. It sits beside the text rather than over
   * it, so the room it needs is the block's to reserve — the hand-written version floated the
   * button over the text and remembered a `pr-12` to keep the first line out from under it.
   */
  actionSlot?: SlotNode;
  /**
   * What a line too long for the block does. Off, the default, it runs on and the block scrolls
   * sideways, which is right for code and config: a wrapped line of JSON reads as two. On, it
   * wraps, breaking inside a word if it has to, which is right for output, a log, or one long
   * value such as a URL.
   */
  wrap?: boolean | undefined;
  /**
   * The tallest the block may get before it scrolls inside itself. Left out, it is as tall as
   * its text. A named height rather than a class, so the blocks in an app are one of three
   * heights instead of a `max-h-*` each.
   */
  maxHeight?: keyof typeof MAX_HEIGHTS | undefined;
  /** The block's root: its width, its margin. */
  className?: string | undefined;
};

type CodeBlockTextProps = Pick<CodeBlockProps, "content" | "wrap" | "maxHeight">;

/**
 * The scrolling text. The one part the platforms draw with different elements.
 *
 * On the web it is a `<pre>` in one box that scrolls both ways. On device `overflow` scrolls
 * nothing and a `Text` always wraps, so the height is a `ScrollView` and a line that must not
 * wrap needs a second, horizontal one inside it.
 *
 * Written as statements rather than a ternary because the two arms are different elements, and
 * the compiler refuses an element chosen at runtime — it folds `Platform.OS === "web"` to `true`,
 * keeps the first arm, and drops the `ScrollView`s below it as unreachable.
 */
function CodeBlockText({ content, wrap, maxHeight }: CodeBlockTextProps) {
  const height = maxHeight ? MAX_HEIGHTS[maxHeight] : undefined;

  if (Platform.OS === "web") {
    return (
      <View
        testID="code-block-content"
        // A region that scrolls has to be reachable by keyboard, or only a mouse wheel can read
        // the end of the line (axe `scrollable-region-focusable`). A block that wraps and has no
        // cap cannot scroll, so it takes no tab stop — which is what keeps a one-line value
        // beside its copy button from being two stops.
        tabIndex={wrap && !maxHeight ? undefined : 0}
        className={cn("min-w-0 flex-1 overflow-auto p-3", height)}
      >
        <Text
          webAs="pre"
          className={cn(
            TEXT,
            // `self-start` lets an unwrapped line be as wide as it is, so the box scrolls to the
            // end of it with the padding still there.
            wrap ? "whitespace-pre-wrap wrap-anywhere" : "self-start whitespace-pre",
          )}
        >
          {content}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      testID="code-block-content"
      // Android hands a vertical drag to the outermost scroller unless the inner one asks, and a
      // capped block is nearly always inside a screen that scrolls.
      nestedScrollEnabled
      className={cn("min-w-0 flex-1", height)}
      // Unwrapped, the padding is the sideways scroller's, so it travels with the end of the line.
      contentContainerClassName={wrap ? "p-3" : ""}
    >
      {wrap ? (
        <Text selectable className={TEXT}>
          {content}
        </Text>
      ) : (
        <ScrollView horizontal contentContainerClassName="p-3">
          <Text selectable className={TEXT}>
            {content}
          </Text>
        </ScrollView>
      )}
    </ScrollView>
  );
}

/**
 * A block of preformatted text: a config file, a command, a payload, a log.
 *
 * - `content` is a string and is drawn as written. There is no syntax highlighting.
 * - `actionSlot` is the far end, top-aligned, in a column of its own — the text never runs under
 *   it.
 * - `wrap` chooses between wrapping a long line and scrolling sideways (the default).
 * - `maxHeight` caps the block, which then scrolls inside itself.
 *
 * A value to copy — an endpoint, a token, a command — is this with `wrap` and a `CopyButton`
 * as its `actionSlot`, not a second component: one line of text is a short block.
 */
export function CodeBlock({
  content,
  actionSlot,
  wrap = false,
  maxHeight,
  className,
}: CodeBlockProps) {
  return (
    <View
      testID="code-block"
      className={cn(
        "flex-row items-start rounded-md border border-foreground/10 bg-foreground/10",
        className,
      )}
    >
      <CodeBlockText content={content} wrap={wrap} maxHeight={maxHeight} />
      {actionSlot ? (
        // `p-0.5` and not the text's `p-3`: an icon button is as tall as a line of text and its
        // padding together, so a one-line block stays one line tall with the button in it.
        <View testID="code-block-action" className="shrink-0 p-0.5">
          {actionSlot}
        </View>
      ) : null}
    </View>
  );
}
