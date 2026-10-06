import { Text } from "react-native";
import { CardLayout, type CardLayoutProps } from "@/components/card-layout.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * One group of settings on a card.
 *
 * cubeui's `CardLayout`, with two things said once instead of in every panel. The title is
 * drawn at the size of a field group's name: `CardTitle` is 24px and the page title over it is
 * 20px, so a panel of cards read as four headlines under a caption (cubicecho/cubeui#249). And
 * the body is a column with a gap, which a card's body is not on the web (cubicecho/cubeui#241).
 */
export function SettingsCard({
  title,
  contentClassName,
  ...props
}: Omit<CardLayoutProps, "title"> & { title: string }) {
  return (
    <CardLayout
      {...props}
      // A `Text` inside the heading's own, so it is still the heading and only the size changes.
      // The heading's tracking is 24px type's, and at this size it pulls the last letter out
      // from under the truncating box.
      title={<Text className="text-base tracking-normal">{title}</Text>}
      contentClassName={cn("flex flex-col gap-4", contentClassName)}
    />
  );
}
