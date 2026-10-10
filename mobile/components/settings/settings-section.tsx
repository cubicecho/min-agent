import type { ComponentProps } from "react";
import { DescriptionHint } from "@/components/app/description-hint.tsx";
import { Section } from "@/components/section.tsx";

type SettingsSectionProps = Omit<ComponentProps<typeof Section>, "title"> & { title: string };

/**
 * cubeui's `Section`, with its description folded behind an info button beside the title when
 * this device has descriptions turned off (cubicecho/min-agent#86).
 *
 * @param props - `Section`'s, with a title that is a string.
 * @returns The section.
 */
export function SettingsSection({ title, description, ...props }: SettingsSectionProps) {
  return (
    <DescriptionHint
      label={title}
      description={description}
      render={(parts) => <Section {...props} title={parts.label} description={parts.description} />}
    />
  );
}
