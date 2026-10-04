import type { ReactNode } from "react";
import { OptionSelect, type SelectEntry } from "@/components/option-select";
import { FieldWrapper, useFieldContext } from "@/components/ui/form";
import { Input, type InputProps } from "@/components/ui/input";
import { Textarea, type TextareaProps } from "@/components/ui/textarea";

/**
 * The bound fields the settings panels need and neither cubeui nor `app-form` ships. Each reads
 * the field it is rendered under, so it goes inside a `form.AppField`:
 *
 * ```tsx
 * <form.AppField name="baseUrl">{() => <TextField label="Base URL" description="…" />}</form.AppField>
 * ```
 */

type TextFieldProps = {
  label: string;
  /** A line under the box — what to put in it, or what changing it costs. */
  description?: ReactNode | undefined;
  required?: boolean | undefined;
} & Omit<InputProps, "value" | "onChangeText" | "onBlur">;

/**
 * A line of text with a hint under it. cubeui's `InputField` takes a label and nothing else for
 * the field's shell, and most of the boxes on these panels need the line that says what goes in
 * them. Bound through the field context, so it is used inside any `form.AppField`.
 */
export function TextField({ label, description, required, ...props }: TextFieldProps) {
  const field = useFieldContext<string>();
  return (
    <FieldWrapper
      label={label}
      description={description}
      required={required}
      control={
        <Input
          {...props}
          value={field.state.value ?? ""}
          onBlur={field.handleBlur}
          onChangeText={field.handleChange}
        />
      }
    />
  );
}

type LongTextFieldProps = {
  label: string;
  description?: ReactNode | undefined;
} & Omit<TextareaProps, "value" | "onChangeText" | "onBlur">;

/** `TextField`'s several-line twin, for the same reason: `TextAreaField` has no hint line. */
export function LongTextField({ label, description, ...props }: LongTextFieldProps) {
  const field = useFieldContext<string>();
  return (
    <FieldWrapper
      label={label}
      description={description}
      control={
        <Textarea
          {...props}
          value={field.state.value ?? ""}
          onBlur={field.handleBlur}
          onChangeText={field.handleChange}
        />
      }
    />
  );
}

/** A select needs a non-empty value, so "unset" gets a sentinel that never reaches the form. */
const UNSET = "__none__";

type OptionalSelectFieldProps = {
  label: string;
  description?: ReactNode | undefined;
  /** What the "nothing picked" row says. */
  emptyLabel: string;
  options: readonly SelectEntry[];
  disabled?: boolean | undefined;
};

/**
 * A choice that may be left unmade: the list, with a row above it that stores an empty string.
 * `OptionSelectField` binds the value as it is, and an empty value has no row to show.
 */
export function OptionalSelectField({
  label,
  description,
  emptyLabel,
  options,
  disabled,
}: OptionalSelectFieldProps) {
  const field = useFieldContext<string | undefined>();
  return (
    <FieldWrapper
      label={label}
      description={description}
      control={
        <OptionSelect
          aria-label={label}
          disabled={disabled}
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
