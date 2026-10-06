import { EMBED_ICONS, type EmbedIcon } from "@shared/types.ts";
import { EMBED_ICON } from "@/components/apps/embed-icon.ts";
import { FieldWrapper, useFieldContext } from "@/components/ui/form.tsx";
import { SegmentedButton, SegmentedGroup } from "@/components/ui/segmented.tsx";

type EmbedIconPickerProps = {
  value: EmbedIcon;
  onValueChange: (value: EmbedIcon) => void;
  "aria-labelledby"?: string | undefined;
};

/**
 * The icons an embed may wear, as a row of glyphs to pick one from. The glyph is the whole
 * button; its stored name is what a screen reader hears.
 */
export function EmbedIconPicker({ value, onValueChange, ...props }: EmbedIconPickerProps) {
  return (
    <SegmentedGroup
      {...props}
      variant="plain"
      labelHideBelow="always"
      value={value}
      onValueChange={(next) => onValueChange(next as EmbedIcon)}
      className="flex-wrap"
    >
      {EMBED_ICONS.map((name) => {
        const Glyph = EMBED_ICON[name];
        return (
          <SegmentedButton key={name} value={name} iconSlot={<Glyph />}>
            {name}
          </SegmentedButton>
        );
      })}
    </SegmentedGroup>
  );
}

/** The picker bound to a form field. Used inside a `form.AppField`. */
export function EmbedIconField({
  label,
  description,
}: {
  label: string;
  description?: string | undefined;
}) {
  const field = useFieldContext<EmbedIcon>();
  return (
    <FieldWrapper
      asGroup
      label={label}
      description={description}
      controlSlot={
        <EmbedIconPicker
          value={field.state.value}
          onValueChange={(next) => {
            field.handleChange(next);
            field.handleBlur();
          }}
        />
      }
    />
  );
}
