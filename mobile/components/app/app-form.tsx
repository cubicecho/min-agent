import { useState } from "react";
import { ComboboxField } from "@/components/ui/combobox-field.tsx";
import {
  createAppForm,
  type FieldProps,
  FieldWrapper,
  splitProps,
  useFieldContext,
} from "@/components/ui/form.tsx";
import { Input, type InputProps } from "@/components/ui/input";

type NumberFieldProps = FieldProps &
  Omit<InputProps, "value" | "onChangeText" | "onBlur" | "type"> & {
    /** For the values a schema keeps whole — token counts, loop limits. Rounds on the way out. */
    integer?: boolean | undefined;
  };

/**
 * A number, typed as text, that writes `0` for an empty box.
 *
 * cubeui's own `NumberField` writes `number | null`, with an empty box as `null`. Every number on
 * the settings panels is stored as a plain number, and an empty one has always meant `0` ("0 asks
 * the server"), so this one stays until those values take `null`.
 *
 * @param props - The field's label and description, and the `Input` props.
 * @returns The field.
 */
function NumberField(props: NumberFieldProps) {
  const [fieldProps, { integer, ...control }] = splitProps(props);
  const field = useFieldContext<number>();
  const value = field.state.value;
  const [text, setText] = useState(() => String(value));
  const [seen, setSeen] = useState(value);

  // A value that moved anywhere but in this box — a reset, a save reading the row back —
  // replaces what is typed. Adjusting state while rendering is React's own answer to state
  // derived from a prop; an effect would paint the stale text first.
  if (value !== seen) {
    setSeen(value);
    setText(String(value));
  }

  return (
    <FieldWrapper
      {...fieldProps}
      controlSlot={
        <Input
          inputMode={integer ? "numeric" : "decimal"}
          {...control}
          value={text}
          onChangeText={(next) => {
            setText(next);
            // An empty box reads as 0; anything that is not a number yet — "1e", a lone "-" —
            // is left as typed and the form keeps the last value that was one.
            const parsed = next.trim() === "" ? 0 : Number(next);
            const isUnparsable = Number.isFinite(parsed) === false;
            if (isUnparsable) {
              return;
            }
            const rounded = integer ? Math.round(parsed) : parsed;
            setSeen(rounded);
            field.handleChange(rounded);
          }}
          // Leaving the field settles what is in it back to the number that was stored, so a
          // trailing dot or a rounded-away fraction stops claiming otherwise.
          onBlur={() => {
            setText(String(field.state.value));
            field.handleBlur();
          }}
        />
      }
    />
  );
}

/**
 * The app's form hook: cubeui's native fields, its `ComboboxField`, and the app's `NumberField`,
 * joined once here so every form reaches all of them on `field.*`.
 */
export const { useAppForm, withForm } = createAppForm({
  NumberField,
  ComboboxField,
});
