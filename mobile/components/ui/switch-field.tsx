import { Pressable, Text, View } from "react-native";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  SWITCH_FIELD_DESCRIPTION_CLASS,
  SWITCH_FIELD_LABEL_CLASS,
  type SwitchFieldProps,
  switchFieldIds,
} from "@/components/ui/switch-field-base";
import { cn } from "@/lib/utils";

/** A switch with its caption on one row, where pressing the caption toggles it. */
export function SwitchField({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  hint,
  className,
  labelClassName,
}: SwitchFieldProps) {
  const { descriptionId } = switchFieldIds(id);
  return (
    <View className={cn("flex-row gap-2", description ? "items-start" : "items-center", className)}>
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        hint={hint}
        // Device has no `htmlFor`, so the caption names the switch here.
        accessibilityLabel={label}
        aria-describedby={description ? descriptionId : undefined}
      />
      <Pressable
        disabled={disabled}
        onPress={() => onCheckedChange(!checked)}
        className="min-w-0 shrink gap-0.5"
      >
        <Label
          htmlFor={id}
          className={cn(SWITCH_FIELD_LABEL_CLASS, disabled && "opacity-50", labelClassName)}
        >
          {label}
        </Label>
        {description ? (
          <Text nativeID={descriptionId} className={SWITCH_FIELD_DESCRIPTION_CLASS}>
            {description}
          </Text>
        ) : null}
      </Pressable>
    </View>
  );
}

export type { SwitchFieldProps };
