import { CardLayout, type CardLayoutProps } from "@/components/card-layout.tsx";
import { useDescriptionPlacement } from "@/lib/display-settings.ts";
import { cn } from "@/lib/utils.ts";

/**
 * One group of settings on a card.
 *
 * cubeui's `CardLayout`, with three things said once instead of in every panel. The title is
 * drawn at the size of a field group's name: `CardTitle` is 24px and the page title over it is
 * 20px, so a panel of cards read as four headlines under a caption (cubicecho/cubeui#249). The
 * body is a column with a gap, which a card's body is not on the web (cubicecho/cubeui#241). And
 * the description is folded behind a button beside the title when this device has descriptions
 * turned off.
 *
 * @param props - `CardLayout`'s props, with the title as a string.
 * @returns The card.
 */
export function SettingsCard({
  titleClassName,
  contentClassName,
  ...props
}: Omit<CardLayoutProps, "title"> & { title: string }) {
  const descriptionPlacement = useDescriptionPlacement();
  return (
    <CardLayout
      descriptionPlacement={descriptionPlacement}
      {...props}
      // A string title, so the folded description's button is named "About <title>".
      titleClassName={cn("text-base tracking-normal", titleClassName)}
      contentClassName={cn("flex flex-col gap-4", contentClassName)}
    />
  );
}
