import { Pressable, View } from "react-native";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SWITCH_FIELD_LABEL_CLASS, type SwitchFieldProps } from "@/components/ui/switch-field-base";
import { cn } from "@/lib/utils";

export function SwitchField({
  id,
  label,
  checked,
  onCheckedChange,
  className,
  labelClassName,
}: SwitchFieldProps) {
  return (
    <View className={cn("flex-row items-center gap-2", className)}>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
      <Pressable onPress={() => onCheckedChange(!checked)}>
        <Label htmlFor={id} className={cn(SWITCH_FIELD_LABEL_CLASS, labelClassName)}>
          {label}
        </Label>
      </Pressable>
    </View>
  );
}

export type { SwitchFieldProps };
