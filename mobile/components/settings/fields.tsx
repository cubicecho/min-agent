import { Combobox, type SelectEntry } from "@/components/combobox.tsx";
import { type FieldProps, FieldWrapper, useFieldContext } from "@/components/ui/form.tsx";

/** A select needs a non-empty value, so "unset" gets a sentinel that never reaches the form. */
const UNSET = "__none__";

type OptionalSelectFieldProps = Omit<FieldProps, "label"> & {
  label: string;
  /** What the "nothing picked" row says. */
  emptyLabel: string;
  options: readonly SelectEntry[];
  disabled?: boolean | undefined;
  /** A search box over the list, for one too long to scroll. */
  searchable?: boolean | undefined;
  searchPlaceholder?: string | undefined;
};

/**
 * A choice that may be left unmade: the list, with a row above it that stores an empty string.
 *
 * cubeui's `ComboboxField clearable` writes `null` for that row, and the settings schema keeps
 * task models as strings, where `""` is a task that is off. Used inside a `form.AppField`.
 *
 * @param props - The field's label and description, the options, and the row for nothing.
 * @returns The field.
 */
export function OptionalSelectField({
  label,
  emptyLabel,
  options,
  disabled,
  searchable,
  searchPlaceholder,
  ...fieldProps
}: OptionalSelectFieldProps) {
  const field = useFieldContext<string | undefined>();
  return (
    <FieldWrapper
      {...fieldProps}
      label={label}
      controlSlot={
        <Combobox
          aria-label={label}
          disabled={disabled}
          searchable={searchable}
          searchPlaceholder={searchPlaceholder}
          options={[{ label: emptyLabel, value: UNSET }, ...options]}
          value={field.state.value || UNSET}
          onValueChange={(next) => {
            field.handleChange(next === UNSET ? "" : next);
            field.handleBlur();
          }}
        />
      }
    />
  );
}
