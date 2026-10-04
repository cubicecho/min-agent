import { useImperativeHandle, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Search, X } from "@/components/ui/icons";
import { Input, type InputHandle, type InputProps } from "@/components/ui/input";
import {
  SEARCH_CLEAR_LABEL,
  type SearchInputOwnProps,
  searchInputName,
} from "@/components/ui/search-input-base";

export type SearchInputProps = Omit<InputProps, "type" | "leading" | "trailing"> &
  SearchInputOwnProps;

export function SearchInput({
  label,
  clearLabel = SEARCH_CLEAR_LABEL,
  clearable = true,
  value,
  defaultValue,
  onChangeText,
  disabled,
  id,
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledBy,
  ref,
  ...props
}: SearchInputProps) {
  const [draft, setDraft] = useState(defaultValue ?? "");
  const text = value ?? draft;
  const inner = useRef<InputHandle>(null);
  useImperativeHandle<InputHandle, InputHandle>(ref, () => ({
    focus: () => inner.current?.focus(),
  }));

  const change = (next: string) => {
    if (value === undefined) setDraft(next);
    onChangeText?.(next);
  };

  return (
    <Input
      {...props}
      ref={inner}
      type="search"
      value={text}
      onChangeText={change}
      disabled={disabled}
      id={id}
      aria-label={searchInputName({ label, ariaLabel, ariaLabelledBy, id })}
      aria-labelledby={ariaLabelledBy}
      leading={<Search />}
      trailing={
        clearable && text !== "" && !disabled ? (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={clearLabel}
            onPress={() => {
              change("");
              inner.current?.focus();
            }}
          >
            <X />
          </Button>
        ) : undefined
      }
    />
  );
}
