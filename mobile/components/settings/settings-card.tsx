import { CardLayout, type CardLayoutProps } from "@/components/card-layout.tsx";
import { useDescriptionPlacement } from "@/lib/display-settings.ts";

/**
 * One group of settings on a card.
 *
 * cubeui's `CardLayout`, with the description folded behind a button beside the title when this
 * device has descriptions turned off, said once instead of in every panel. The title is a string
 * so that button is named "About <title>". The body already spaces its fields 16px apart.
 *
 * @param props - `CardLayout`'s props, with the title as a string.
 * @returns The card.
 */
export function SettingsCard(props: Omit<CardLayoutProps, "title"> & { title: string }) {
  const descriptionPlacement = useDescriptionPlacement();
  return <CardLayout descriptionPlacement={descriptionPlacement} {...props} />;
}
