import { Children, Fragment, isValidElement, type ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { EmptyState, type EmptyStateProps } from "@/components/empty-state";
import { PAGE_COLUMN, PROSE_COLUMN } from "@/components/header-content-footer";
import { PageHeader, type PageHeaderProps, PageInsetContext } from "@/components/page-header";
import { cn, type SlotNode } from "@/lib/utils";

type PageProps = {
  className?: string;
  /** The screen's body: the header, the grid, the rows, in the order they are drawn. */
  contentSlot: SlotNode;
  /**
   * Full-height flex column (`h-full min-h-0`) instead of the default `flex-1`.
   * For a view whose body scrolls internally rather than as a whole.
   */
  fill?: boolean;
  /** Whether the page itself scrolls. Off for views with an inner scroll area. */
  scroll?: boolean;
  /** `narrow` is the prose column (`max-w-3xl`), PageLayout's own — a settings or detail form. */
  width?: "narrow";
};

/**
 * The page shell a route wraps its content in: a padded, centred column that scrolls unless told
 * not to.
 */
export function Page({ className, contentSlot, fill = false, scroll = true, width }: PageProps) {
  // PageLayout's named columns, not `container`, whose width snapped at every breakpoint; and a
  // `gap-4` between what the page holds, which its header's doc always told callers to rely on.
  const content = cn(width === "narrow" ? PROSE_COLUMN : PAGE_COLUMN, "gap-4 px-4 py-4", className);
  const outer = fill ? "h-full min-h-0" : "flex-1";

  // The page insets its content, so a PageHeader in it does not inset itself again.
  if (scroll === false) {
    return (
      <PageInsetContext.Provider value={true}>
        <View className={cn(outer, "flex-col", content)}>{contentSlot}</View>
      </PageInsetContext.Provider>
    );
  }

  return (
    <PageInsetContext.Provider value={true}>
      <ScrollView className={outer} contentContainerClassName={content}>
        {contentSlot}
      </ScrollView>
    </PageInsetContext.Provider>
  );
}

/**
 * The title row at the top of a page. There is one `PageHeader` in this set, and it lives in
 * `page-header`; it is re-exported here so a screen importing it from its page shell keeps
 * working. It took over from the small one this file used to carry, whose props were renamed on
 * the way: `subtitle` is `description`, `actions` is `actionSlot`, the heading is an `h1` unless
 * `level` says otherwise, and the `mb-4` under it is gone — space it with the page's own gap.
 */
export { PageHeader, type PageHeaderProps };

/**
 * The responsive card grid shared by list pages.
 *
 * `grid` has no native equivalent, so the columns come from flex wrapping plus
 * a percentage width on each cell. Each card is wrapped here rather than at the
 * call sites: the width has to sit on the cell, and a `Card` that carried it
 * would then only be layout-correct inside a grid.
 *
 * The cards are `contentSlot`, as an array or a fragment. Both are opened, so a
 * fragment of three cards is three cells and not one.
 */
export function CardGrid({
  className,
  contentSlot,
}: {
  className?: string;
  contentSlot: SlotNode;
}) {
  return (
    <View className={cn("flex-row flex-wrap gap-4", className)}>
      {cells(contentSlot).map(({ key, cell }) => (
        // The basis is a fraction of the row minus its share of the `gap-4`
        // above, which flex-basis percentages do not account for.
        <View
          key={key}
          className="w-full sm:w-[calc(50%-0.5rem)] lg:w-[calc(33.333%-0.667rem)] xl:w-[calc(25%-0.75rem)]"
        >
          {cell}
        </View>
      ))}
    </View>
  );
}

/**
 * A slot's elements, one per cell: arrays and fragments opened, the nothing values dropped. A
 * card's key is prefixed with its fragment's, since two opened fragments number their cards alike.
 */
function cells(slot: SlotNode, prefix = ""): { key: string; cell: ReactElement }[] {
  return Children.toArray(slot).flatMap((child) => {
    if (isValidElement<{ children?: SlotNode }>(child) === false) {
      return [];
    }
    const key = `${prefix}${child.key}`;
    return child.type === Fragment ? cells(child.props.children, key) : [{ key, cell: child }];
  });
}

/**
 * The empty state, which is its own item, `@cubeui/empty-state`, so an app that wants one does not
 * install the page shell for it. Re-exported here, beside `CardGrid` it is usually drawn under, so
 * a screen importing it from its page shell keeps working.
 */
export { EmptyState, type EmptyStateProps };
