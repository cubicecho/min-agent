export type SwitchFieldProps = {
  /** The switch's id. On web it is also what the caption's `<label htmlFor>` points at. */
  id: string;
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string | undefined;
  labelClassName?: string | undefined;
};

/** The caption's type, shared so the two halves cannot drift on it. */
export const SWITCH_FIELD_LABEL_CLASS = "text-sm text-muted-foreground";
