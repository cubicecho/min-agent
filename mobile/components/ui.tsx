import { Feather } from "@react-native-vector-icons/feather";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  type PressableProps,
  Switch as RNSwitch,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { type Colors, useColors } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The React Native counterparts of the web app's shadcn components. Radix is
 * DOM-only, so these are rewritten rather than shared — but the variant names and
 * Tailwind vocabulary are kept identical so screen code reads the same on both sides.
 */

export type IconName = React.ComponentProps<typeof Feather>["name"];

/* ----------------------------------------------------------------------- button */

const buttonVariants = cva(
  "flex-row shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent",
  {
    variants: {
      variant: {
        default: "bg-primary active:opacity-80",
        outline: "border-border bg-background active:bg-muted",
        secondary: "bg-secondary active:opacity-80",
        ghost: "active:bg-muted",
        destructive: "bg-destructive/10 active:bg-destructive/20",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2.5",
        lg: "h-11 px-4",
        icon: "h-9 w-9 px-0",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const buttonText = cva("text-sm font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      outline: "text-foreground",
      secondary: "text-secondary-foreground",
      ghost: "text-foreground",
      destructive: "text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

// Feather takes a colour prop rather than a class, so each variant names its own.
const iconColor = (colors: Colors): Record<NonNullable<ButtonProps["variant"]>, string> => ({
  default: colors.primaryForeground,
  outline: colors.foreground,
  secondary: colors.secondaryForeground,
  ghost: colors.foreground,
  destructive: colors.destructive,
});

export type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    className?: string;
    icon?: IconName;
    children?: ReactNode;
    busy?: boolean;
  };

export function Button({
  className,
  variant = "default",
  size = "default",
  icon,
  busy,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const colors = useColors();
  const off = disabled || busy;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      className={cn(buttonVariants({ variant, size }), off && "opacity-50", className)}
      {...props}
    >
      {busy ? (
        <ActivityIndicator size="small" />
      ) : (
        icon && <Feather name={icon} size={15} color={iconColor(colors)[variant ?? "default"]} />
      )}
      {typeof children === "string" ? (
        <Text className={buttonText({ variant })}>{children}</Text>
      ) : (
        children
      )}
    </Pressable>
  );
}

/* ------------------------------------------------------------------------- card */

export const Card = ({ className, children }: { className?: string; children: ReactNode }) => (
  <View className={cn("gap-3 rounded-xl border border-border bg-card p-4", className)}>
    {children}
  </View>
);

export const CardTitle = ({ children }: { children: ReactNode }) => (
  <Text className="text-base font-semibold text-card-foreground">{children}</Text>
);

export const CardDescription = ({ children }: { children: ReactNode }) => (
  <Text className="text-sm text-muted-foreground">{children}</Text>
);

/* ------------------------------------------------------------------------ input */

export type InputProps = TextInputProps & { className?: string };

export const Input = ({ className, ...props }: InputProps) => (
  <TextInput
    placeholderTextColor={useColors().mutedForeground}
    className={cn(
      "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground",
      className,
    )}
    {...props}
  />
);

export const Textarea = ({ className, ...props }: InputProps) => (
  <TextInput
    multiline
    textAlignVertical="top"
    placeholderTextColor={useColors().mutedForeground}
    className={cn(
      "min-h-24 rounded-lg border border-input bg-background p-3 text-sm text-foreground",
      className,
    )}
    {...props}
  />
);

/** A labelled control, with optional helper text under it. */
export const Field = ({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) => (
  <View className="gap-1.5">
    <Text className="text-sm font-medium text-foreground">{label}</Text>
    {children}
    {hint ? <Text className="text-xs text-muted-foreground">{hint}</Text> : null}
  </View>
);

/* ------------------------------------------------------------------- badge, misc */

const badgeVariants = cva("shrink-0 self-start rounded-full px-2 py-0.5", {
  variants: {
    variant: {
      default: "bg-primary",
      secondary: "bg-secondary",
      outline: "border border-border",
      destructive: "bg-destructive/10",
    },
  },
  defaultVariants: { variant: "default" },
});

const badgeText = cva("text-xs font-medium", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      destructive: "text-destructive",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  children,
  variant = "default",
  className,
}: VariantProps<typeof badgeVariants> & { children: ReactNode; className?: string }) {
  return (
    <View className={cn(badgeVariants({ variant }), className)}>
      <Text className={badgeText({ variant })}>{children}</Text>
    </View>
  );
}

export const Separator = ({ className }: { className?: string }) => (
  <View className={cn("h-px w-full bg-border", className)} />
);

export const Muted = ({ children, className }: { children: ReactNode; className?: string }) => (
  <Text className={cn("text-xs text-muted-foreground", className)}>{children}</Text>
);

export const Switch = ({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
}) => <RNSwitch value={value} onValueChange={onValueChange} />;

/* ----------------------------------------------------------------------- screens */

/** The standard page frame: padded, scrollable, on the app background. */
export const Screen = ({ children, className }: { children: ReactNode; className?: string }) => (
  <ScrollView
    className="flex-1 bg-background"
    contentContainerClassName={cn("gap-4 p-4", className)}
    keyboardShouldPersistTaps="handled"
  >
    {children}
  </ScrollView>
);

export const Loading = () => (
  <View className="flex-1 items-center justify-center bg-background">
    <ActivityIndicator />
  </View>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <View className="items-center justify-center gap-2 p-8">
    <Text className="text-center text-sm text-muted-foreground">{children}</Text>
  </View>
);

/** Errors surface inline rather than as toasts — a bad server address must stay visible. */
export const ErrorNote = ({ error }: { error: unknown }) =>
  error ? (
    <View className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
      <Text className="text-sm text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </Text>
    </View>
  ) : null;

/* ----------------------------------------------------------------------- select */

export type Option = { label: string; value: string };

/**
 * A modal list rather than a dropdown: there is no portal layer in React Native, and
 * a picker sheet is the platform-native shape on Android anyway.
 */
export function Select({
  value,
  options,
  onChange,
  placeholder = "Select…",
  disabled,
}: {
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => setOpen(true)}
        className={cn(
          "h-10 flex-row items-center justify-between rounded-lg border border-input bg-background px-3",
          disabled && "opacity-50",
        )}
      >
        <Text
          className={cn("text-sm", selected ? "text-foreground" : "text-muted-foreground")}
          numberOfLines={1}
        >
          {selected?.label ?? placeholder}
        </Text>
        <Feather name="chevron-down" size={15} color={colors.mutedForeground} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-center bg-black/50 p-6" onPress={() => setOpen(false)}>
          <View className="max-h-[70%] overflow-hidden rounded-xl border border-border bg-popover">
            <ScrollView>
              {options.length === 0 ? (
                <Empty>Nothing to choose from.</Empty>
              ) : (
                options.map((option) => (
                  <Pressable
                    key={option.value}
                    onPress={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                    className="flex-row items-center justify-between border-b border-border px-4 py-3 active:bg-accent"
                  >
                    <Text className="flex-1 text-sm text-popover-foreground">{option.label}</Text>
                    {option.value === value && (
                      <Feather name="check" size={15} color={colors.foreground} />
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
