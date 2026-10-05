import { Slot } from "radix-ui";
import * as React from "react";
import { Text, View } from "react-native";
import {
  ITEM_ACTIONS_CLASS,
  ITEM_CONTENT_CLASS,
  ITEM_DESCRIPTION_CLASS,
  ITEM_FOOTER_CLASS,
  ITEM_HEADER_CLASS,
  ITEM_SELECTED_CLASS,
  ITEM_SEPARATOR_CLASS,
  ITEM_TITLE_CLASS,
  ITEM_TITLE_TEXT,
  type ItemMediaVariant,
  type ItemSize,
  type ItemVariant,
  itemMediaVariants,
  itemVariants,
} from "@/components/ui/item-base";
import { cn } from "@/lib/utils";

// `className` is re-declared rather than inherited: nativewind types it as `className?: string`,
// which under `exactOptionalPropertyTypes` rejects the conditional a call site passes.
type ViewProps = Omit<React.ComponentProps<typeof View>, "className"> & {
  className?: string | undefined;
};
type TextProps = Omit<React.ComponentProps<typeof Text>, "className"> & {
  className?: string | undefined;
};

/** The ink and type a string in a part is drawn with, where nothing is inherited. */
const PART_TEXT = "text-foreground text-sm";

/**
 * Each string or number child in its own `Text`, elements left as they are. A part holds a badge
 * beside a word as often as a word alone, so it is the children one by one, not all or nothing.
 */
function withText(children: React.ReactNode, className: string) {
  return React.Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <Text className={className}>{child}</Text>
    ) : (
      child
    ),
  );
}

function ItemGroup({ className, ...props }: ViewProps) {
  return <View testID="item-group" className={cn("flex-col", className)} {...props} />;
}

type ItemSeparatorProps = Omit<ViewProps, "children"> & {
  orientation?: "horizontal" | "vertical" | undefined;
  /**
   * shadcn's: a decorative rule is hidden from assistive technology, which is the default. `false`
   * announces it as a separator between the rows either side.
   */
  decorative?: boolean | undefined;
};

function ItemSeparator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: ItemSeparatorProps) {
  return (
    <View
      testID="item-separator"
      {...(decorative ? { "aria-hidden": true } : { role: "separator" as const })}
      className={cn(
        ITEM_SEPARATOR_CLASS,
        orientation === "vertical" ? "h-full w-px" : "h-px w-full",
        className,
      )}
      {...props}
    />
  );
}

type ItemProps = ViewProps & {
  variant?: ItemVariant | null | undefined;
  size?: ItemSize | null | undefined;
  /**
   * Hand the row's classes to the one child instead of a `View` around it — a `Pressable` that
   * opens the record, an expo-router `Link`. Radix's `Slot`, as on `Button`.
   */
  asChild?: boolean | undefined;
  /**
   * The chosen row: the one open beside the list. Tinted in `active`. Set `aria-current` or
   * `aria-selected` on the row or the link inside as well.
   */
  selected?: boolean | undefined;
};

function Item({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  selected = false,
  ...props
}: ItemProps) {
  const classes = cn(itemVariants({ variant, size }), selected && ITEM_SELECTED_CLASS, className);
  if (asChild) {
    // `Slot.Root` is typed for the DOM, but it renders nothing of its own — it clones the caller's
    // one child with these props merged in — so the cast is the honest way to say neither side's
    // typing describes it (`Button` does the same).
    return (
      <Slot.Root className={classes} {...(props as unknown as React.HTMLAttributes<HTMLElement>)} />
    );
  }
  return <View testID="item" className={classes} {...props} />;
}

type ItemMediaProps = ViewProps & { variant?: ItemMediaVariant | null | undefined };

function ItemMedia({ className, variant = "default", ...props }: ItemMediaProps) {
  return (
    <View
      testID="item-media"
      className={cn(itemMediaVariants({ variant }), className)}
      {...props}
    />
  );
}

function ItemContent({ className, children, ...props }: ViewProps) {
  return (
    <View testID="item-content" className={cn(ITEM_CONTENT_CLASS, className)} {...props}>
      {withText(children, PART_TEXT)}
    </View>
  );
}

/**
 * A `View` holding the line, not a `Text`, because the line is as often a badge beside a word as a
 * word — and a `View` inside a `Text` is not a row on a device. The string gets the title's type.
 */
function ItemTitle({ className, children, ...props }: ViewProps) {
  return (
    <View testID="item-title" className={cn("self-start", ITEM_TITLE_CLASS, className)} {...props}>
      {withText(children, cn("text-foreground", ITEM_TITLE_TEXT))}
    </View>
  );
}

function ItemDescription({ className, ...props }: TextProps) {
  return (
    <Text testID="item-description" className={cn(ITEM_DESCRIPTION_CLASS, className)} {...props} />
  );
}

function ItemActions({ className, children, ...props }: ViewProps) {
  return (
    <View testID="item-actions" className={cn(ITEM_ACTIONS_CLASS, className)} {...props}>
      {withText(children, PART_TEXT)}
    </View>
  );
}

function ItemHeader({ className, children, ...props }: ViewProps) {
  return (
    <View testID="item-header" className={cn("w-full", ITEM_HEADER_CLASS, className)} {...props}>
      {withText(children, PART_TEXT)}
    </View>
  );
}

function ItemFooter({ className, children, ...props }: ViewProps) {
  return (
    <View testID="item-footer" className={cn("w-full", ITEM_FOOTER_CLASS, className)} {...props}>
      {withText(children, PART_TEXT)}
    </View>
  );
}

export {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemHeader,
  ItemMedia,
  ItemSeparator,
  ItemTitle,
};
