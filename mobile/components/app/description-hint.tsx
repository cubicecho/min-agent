import { type ComponentProps, type ReactNode, useState } from "react";
import { Pressable } from "react-native";
import { FieldWrapper } from "@/components/ui/form.tsx";
import { Info } from "@/components/ui/icons";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDisplaySettings } from "@/lib/display-settings.ts";

/**
 * A description that can be folded away behind an info button.
 *
 * cubeui's web `FormField` has this as `descriptionPlacement="popover"`; the native half, and
 * `CardLayout` and `Section` on both, do not yet (cubicecho/cubeui#319). Until they do it is
 * done here, from outside, and this file goes when it lands (cubicecho/min-agent#86).
 */

/** A label and its description, as the shell that draws them should be handed them. */
type HintParts = {
  label: ReactNode;
  description: ReactNode | undefined;
};

type DescriptionHintProps = {
  /** The name of the thing described. Names the button ("About Base URL") and heads the popup. */
  label: string;
  description: ReactNode | undefined;
  /** Draws the shell from the label and description it should show. */
  render: (parts: HintParts) => ReactNode;
};

/**
 * Hands `render` the label and description as they are while descriptions are shown. With them
 * turned off on this device, it hands back the label with an info button after it and no
 * description, and the button opens the description in a popup.
 *
 * The popover wraps the shell rather than sitting inside the label: a label is a `Text` on
 * device, and the popup is a `Modal`, which has no business inside one.
 *
 * @param props.label - The name of the thing described.
 * @param props.description - What would have been drawn under it.
 * @param props.render - Draws the shell from the parts it is handed.
 * @returns The shell, alone or inside the popover its button opens.
 */
export function DescriptionHint({ label, description, render }: DescriptionHintProps) {
  const { showDescriptions } = useDisplaySettings();
  const [open, setOpen] = useState(false);
  const hasNothingToHide = showDescriptions || Boolean(description) === false;
  if (hasNothingToHide) {
    return render({ label, description });
  }

  const hinted = (
    <>
      {label}
      <PopoverTrigger asChild>
        <Pressable
          role="button"
          aria-label={`About ${label}`}
          hitSlop={8}
          // The press is handled here, not left to the trigger: on the web the trigger opens on
          // `onClick`, which a `Pressable` keeps for itself. On device the trigger replaces this
          // with its own, which opens the same state.
          onPress={() => setOpen((isOpen) => isOpen === false)}
          className="ml-1.5 web:inline-flex web:cursor-pointer web:align-middle"
        >
          <Info className="size-3.5 text-muted-foreground" />
        </Pressable>
      </PopoverTrigger>
    </>
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {render({ label: hinted, description: undefined })}
      <PopoverContent align="start" aria-label={`About ${label}`}>
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
          <PopoverDescription>{description}</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  );
}

type HintedFieldWrapperProps = Omit<ComponentProps<typeof FieldWrapper>, "label"> & {
  label: string;
};

/**
 * cubeui's `FieldWrapper`, with its description folded behind an info button when this device
 * has descriptions turned off. What the app's own bound fields are built from.
 *
 * @param props - `FieldWrapper`'s, with a label that is a string.
 * @returns The field.
 */
export function HintedFieldWrapper({ label, description, ...props }: HintedFieldWrapperProps) {
  return (
    <DescriptionHint
      label={label}
      description={description}
      render={(parts) => (
        <FieldWrapper {...props} label={parts.label} description={parts.description} />
      )}
    />
  );
}
