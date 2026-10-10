import { useState } from "react";
import { OptionSelect, type SelectEntry } from "@/components/option-select.tsx";
import { PasswordInput, type PasswordInputProps } from "@/components/password-input.tsx";
import { createAppForm, splitProps, useFieldContext } from "@/components/ui/form.tsx";
import { Input, type InputProps } from "@/components/ui/input";
import { HintedFieldWrapper } from "./description-hint.tsx";

type FieldText = {
  label: string;
  /** A line under the control — what to put in it, or what changing it costs. */
  description?: React.ReactNode | undefined;
};

type PasswordFieldProps = FieldText & Omit<PasswordInputProps, "value" | "onChangeText" | "onBlur">;

/**
 * A secret, as cubeui's `PasswordInput` with its reveal button, bound the way `InputField` is.
 * cubeui ships the input but no field for it.
 */
function PasswordField(props: PasswordFieldProps) {
  const [fieldProps, control] = splitProps(props);
  const field = useFieldContext<string>();
  return (
    <HintedFieldWrapper
      {...fieldProps}
      label={props.label}
      controlSlot={
        <PasswordInput
          // "Show API key", not "Show password": none of these is a password.
          showLabel={`Show ${props.label}`}
          hideLabel={`Hide ${props.label}`}
          {...control}
          value={field.state.value ?? ""}
          onBlur={field.handleBlur}
          onChangeText={field.handleChange}
        />
      }
    />
  );
}

type NumberFieldProps = FieldText &
  Omit<InputProps, "value" | "onChangeText" | "onBlur" | "type"> & {
    /** For the values a schema keeps whole — token counts, loop limits. Rounds on the way out. */
    integer?: boolean | undefined;
  };

/**
 * A number, typed as text.
 *
 * `InputField` with `type="number"` stores `Number(text)` on every keystroke and shows the
 * stored value back, so a decimal cannot be typed through it: "0." is 0, and the dot is gone
 * before the next digit arrives. This keeps what was typed and hands the form a number only
 * when the text is one.
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
    <HintedFieldWrapper
      {...fieldProps}
      label={props.label}
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

type OptionSelectFieldProps = FieldText & {
  options: readonly SelectEntry[];
  placeholder?: string | undefined;
  disabled?: boolean | undefined;
  /** A search box over the list, for one too long to scroll. */
  searchable?: boolean | undefined;
  searchPlaceholder?: string | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
};

/**
 * A choice from a list, as cubeui's `OptionSelect` — groups, notes and all. The registry's own
 * `SelectField` takes flat label/value pairs only, which is not enough for a model list.
 */
function OptionSelectField(props: OptionSelectFieldProps) {
  const [fieldProps, control] = splitProps(props);
  const field = useFieldContext<string>();
  return (
    <HintedFieldWrapper
      {...fieldProps}
      label={props.label}
      controlSlot={
        <OptionSelect
          {...control}
          aria-label={props.label}
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

/**
 * The app's form hook: cubeui's native fields plus the three it does not ship, joined once here
 * so every form reaches all of them on `field.*`.
 */
export const { useAppForm, withForm } = createAppForm({
  PasswordField,
  NumberField,
  OptionSelectField,
});
