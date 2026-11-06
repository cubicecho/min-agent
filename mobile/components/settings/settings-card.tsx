import { CardLayout, type CardLayoutProps } from "@/components/card-layout.tsx";
import { useDescriptionPlacement } from "@/lib/display-settings.ts";
import { cn } from "@/lib/utils.ts";

/**
 * One group of settings on a card.
 *
 * cubeui's `CardLayout`, with two things said once instead of in every panel. The body is a
 * column with a gap between the fields, which a card's body has none of. And the description is
 * folded behind a button beside the title when this device has descriptions turned off. The
 * title is a string so that button is named "About <title>".
 *
 * @param props - `CardLayout`'s props, with the title as a string.
 * @returns The card.
 */
export function SettingsCard({
  contentClassName,
  ...props
}: Omit<CardLayoutProps, "title"> & { title: string }) {
  const descriptionPlacement = useDescriptionPlacement();
  return (
    <CardLayout
      descriptionPlacement={descriptionPlacement}
      {...props}
      contentClassName={cn("flex flex-col gap-4", contentClassName)}
    />
  );
}
