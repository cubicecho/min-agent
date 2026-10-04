import { TextInput } from "react-native";
import { TEXTAREA_CLASS, type TextareaProps } from "@/components/ui/textarea-base";
import { cn } from "@/lib/utils";

function Textarea({
  value,
  defaultValue,
  onChangeText,
  onBlur,
  placeholder,
  rows,
  maxLength,
  disabled,
  className,
  id,
}: TextareaProps) {
  return (
    <TextInput
      multiline
      textAlignVertical="top"
      // Held at `""` unless the caller asked for uncontrolled by passing a `defaultValue`: a bound
      // field's value starts `undefined` more often than not.
      {...(defaultValue === undefined ? { value: value ?? "" } : { value, defaultValue })}
      onChangeText={onChangeText}
      onBlur={onBlur}
      placeholder={placeholder}
      {...(rows !== undefined ? { numberOfLines: rows } : {})}
      {...(maxLength !== undefined ? { maxLength } : {})}
      editable={!disabled}
      id={id}
      className={cn(TEXTAREA_CLASS, disabled && "opacity-50", className)}
    />
  );
}

export type { TextareaProps };
export { Textarea };
