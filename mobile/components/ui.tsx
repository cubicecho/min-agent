import { Feather } from "@react-native-vector-icons/feather";
import { matchTerms } from "@shared/client/search.ts";
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  type PressableProps,
  Switch as RNSwitch,
  ScrollView,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";
import { useCopy } from "@/lib/copy.ts";
import { type Colors, colors } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The React Native counterparts of shadcn's components. Radix is
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
        // Square, and `lg`'s 44px tall: the height of the composer's box with one line in
        // it, so the send button beside it is the same size rather than eight pixels short.
        // It is also the smallest comfortable touch target, which the 36px `icon` is not.
        "icon-lg": "h-11 w-11 px-0",
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

/** The taller sizes get a proportionally bigger glyph, or it swims in the button. */
const glyph = (size: ButtonProps["size"]) => (size === "lg" || size === "icon-lg" ? 17 : 15);

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
        icon && (
          <Feather name={icon} size={glyph(size)} color={iconColor(colors)[variant ?? "default"]} />
        )
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
    placeholderTextColor={colors.mutedForeground}
    className={cn(
      "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground",
      className,
    )}
    {...props}
  />
);

/**
 * What react-native-web actually hands to `onKeyPress`: the React synthetic keyboard
 * event, not the bare `{ key }` React Native's types promise. Reading the rest of it is
 * safe because the handler below only runs on web.
 */
type WebKeyEvent = {
  key: string;
  shiftKey?: boolean;
  nativeEvent?: { isComposing?: boolean; keyCode?: number };
  preventDefault?: () => void;
};

/**
 * `onSubmit` sends on a bare Enter, in a browser. It is deliberately web-only:
 * on a phone the return key is how you get a new line, and there is a send button
 * an inch away.
 */
export const Textarea = ({
  className,
  onSubmit,
  onKeyPress,
  grows,
  rows,
  value,
  style,
  ...props
}: InputProps & { onSubmit?: () => void; grows?: boolean; rows?: number }) => {
  const box = useRef<TextInput>(null);
  const [height, setHeight] = useState<number>();

  /**
   * Measures the content so the box can be exactly as tall as it, between the `min-h-*` and
   * `max-h-*` the caller asks for — both of which still clamp, because they are a real
   * min-height and max-height on the element.
   *
   * Web is measured here rather than through `onContentSizeChange`, which reports
   * `scrollHeight` — never smaller than the box already is, so a box that had grown could
   * never shrink back. Zeroing the height first is the only way to measure content that got
   * shorter. `scrollHeight` covers the padding but not the border, and react-native-web sets
   * `box-sizing: border-box`, so the border has to be added back or the text sits two pixels
   * short of its own box and a scrollbar appears.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: `value` is the trigger, not a read.
  useEffect(() => {
    if (!grows || Platform.OS !== "web") return;
    const node = box.current as unknown as HTMLTextAreaElement | null;
    if (!node) return;
    const style = getComputedStyle(node);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    node.style.height = "0px";
    const measured = node.scrollHeight + border;
    node.style.height = "";
    setHeight(measured);
  }, [grows, value]);

  return (
    <TextInput
      ref={box}
      multiline
      textAlignVertical="top"
      // A browser defaults a `<textarea>` to two rows, and react-native-web passes no `rows`
      // of its own unless told to — so a growing box stood two lines tall before it held
      // anything, and no `min-h-*` could bring it down. The cast is because `rows` is one of
      // the DOM props react-native-web accepts and React Native's types do not carry.
      {...({ rows: grows ? 1 : rows } as TextInputProps)}
      // Native reports a true content height and needs none of the web's care above.
      onContentSizeChange={
        grows && Platform.OS !== "web"
          ? (event) => setHeight(event.nativeEvent.contentSize.height)
          : undefined
      }
      style={[style, grows && height ? { height } : null]}
      value={value}
      placeholderTextColor={colors.mutedForeground}
      onKeyPress={(event) => {
        onKeyPress?.(event);
        if (Platform.OS !== "web" || !onSubmit) return;
        const key = event as unknown as WebKeyEvent;
        // Shift+Enter still breaks the line, and an Enter that is closing an IME candidate
        // list belongs to the IME rather than to us.
        const composing = key.nativeEvent?.isComposing || key.nativeEvent?.keyCode === 229;
        if (key.key !== "Enter" || key.shiftKey || composing) return;
        // This also suppresses react-native-web's own Enter branch, which would blur the box.
        key.preventDefault?.();
        onSubmit();
      }}
      className={cn(
        "min-h-24 rounded-lg border border-input bg-background p-3 text-sm text-foreground",
        className,
      )}
      {...props}
    />
  );
};

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

/* ------------------------------------------------------------------------- copy */

/**
 * Puts something on the clipboard and confirms it in place.
 *
 * Deliberately not a `Button`: it sits over a code fence and under a reply, where a control
 * the size of the ones on a form would be the loudest thing in the message. It is icon-only
 * for the same reason, and names itself to a screen reader instead.
 */
export function CopyButton({
  text,
  label,
  className,
}: {
  text: string;
  /** What is being copied, for the screen reader. "Copy code", "Copy reply". */
  label: string;
  className?: string;
}) {
  const { copied, copy } = useCopy();
  return (
    <Pressable
      onPress={() => void copy(text)}
      accessibilityRole="button"
      accessibilityLabel={copied ? "Copied" : label}
      className={cn("h-7 w-7 items-center justify-center rounded-md active:bg-accent", className)}
    >
      <Feather
        name={copied ? "check" : "copy"}
        size={13}
        color={copied ? colors.foreground : colors.mutedForeground}
      />
    </Pressable>
  );
}

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

/* ----------------------------------------------------------------------- tabs */

export type Tab = { key: string; label: string; icon: IconName };

/**
 * A dot on a tab, for the two things a panel needs to say while you are not looking at it:
 * something in there is broken, or something in there is typed and unsaved.
 */
export type TabMark = "attention" | "unsaved";

const MARK_STYLE: Record<TabMark, string> = {
  attention: "bg-destructive",
  unsaved: "bg-muted-foreground",
};

const MARK_LABEL: Record<TabMark, string> = {
  attention: "needs attention",
  unsaved: "unsaved changes",
};

/**
 * A row of pills that switches which panel is under it.
 *
 * It scrolls sideways rather than wrapping or shrinking, because the set is short and a
 * phone is narrow: the tabs past the edge are reachable by dragging, and the ones on screen
 * stay legible. The pressed pill carries the `muted` fill the drawer's active row does, so
 * "where am I" reads the same whether the nav is the sidebar or this.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  marks,
}: {
  tabs: readonly Tab[];
  value: string;
  onChange: (key: string) => void;
  /** Keyed by tab: a dot beside the label, and a word about it for a screen reader. */
  marks?: Partial<Record<string, TabMark>>;
}) {
  return (
    <View className="border-b border-border bg-background">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-1 p-2"
      >
        {tabs.map((tab) => {
          const active = tab.key === value;
          const mark = marks?.[tab.key];
          return (
            <Pressable
              key={tab.key}
              onPress={() => onChange(tab.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={mark ? `${tab.label}, ${MARK_LABEL[mark]}` : tab.label}
              className={cn(
                "h-9 flex-row items-center gap-2 rounded-lg px-3",
                active ? "bg-muted" : "active:bg-muted",
              )}
            >
              <Feather
                name={tab.icon}
                size={15}
                color={active ? colors.foreground : colors.mutedForeground}
              />
              <Text
                className={cn(
                  "text-sm font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {tab.label}
              </Text>
              {mark ? <View className={cn("h-1.5 w-1.5 rounded-full", MARK_STYLE[mark])} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/* ----------------------------------------------------------------------- select */

export type Option = { label: string; value: string };

/** Below this many options the box is just something in the way, so the sheet hides it. */
const FILTER_AFTER = 8;

/**
 * A modal list rather than a dropdown: there is no portal layer in React Native, and
 * a picker sheet is the platform-native shape on Android anyway.
 *
 * Past a handful of options it grows a filter box. The list that needs it is the models one:
 * an Ollama box with forty tags in it is a sheet you scroll looking for a name you already
 * know, and the terms match the way the session search does — every word, in any order.
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = options.find((option) => option.value === value);
  const shown = matchTerms(options, query, (option) => option.label);

  return (
    <>
      <Pressable
        disabled={disabled}
        onPress={() => {
          // A filter left over from last time would hide options nobody asked to hide.
          setQuery("");
          setOpen(true);
        }}
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
            {options.length > FILTER_AFTER ? (
              <View className="border-b border-border p-2">
                <Input
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Filter"
                  autoCapitalize="none"
                  autoCorrect={false}
                  // On a phone this would open the keyboard over the list you came to read.
                  autoFocus={Platform.OS === "web"}
                  className="h-9"
                />
              </View>
            ) : null}
            {/* Without this, the tap that dismisses the keyboard is the tap that picked. */}
            <ScrollView keyboardShouldPersistTaps="handled">
              {options.length === 0 ? (
                <Empty>Nothing to choose from.</Empty>
              ) : shown.length === 0 ? (
                <Empty>Nothing matches “{query}”.</Empty>
              ) : (
                shown.map((option) => (
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

/* ------------------------------------------------------------------ icon picker */

/**
 * A short, fixed set of glyphs, laid out as the glyphs themselves.
 *
 * A `Select` would work — the values are a dozen strings — but it would ask you to pick an
 * icon by reading the word "check-square" in a sheet that hides the rest of them, and then
 * show you the word again in the closed trigger. You are choosing a picture, so the choice
 * is the pictures: every one on screen at once, one tap, and the one you are on is the one
 * with the outline. It wraps, so a phone gets more rows rather than a narrower grid.
 *
 * Each cell still carries its name as its accessibility label, which is the one place the
 * word is the more useful of the two.
 */
export function IconPicker({
  icons,
  value,
  onChange,
}: {
  icons: readonly IconName[];
  value: string;
  onChange: (icon: IconName) => void;
}) {
  return (
    <View className="flex-row flex-wrap gap-2">
      {icons.map((name) => {
        const active = name === value;
        return (
          <Pressable
            key={name}
            onPress={() => onChange(name)}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={name}
            className={cn(
              "h-11 w-11 items-center justify-center rounded-lg border",
              active ? "border-ring bg-muted" : "border-input bg-background active:bg-muted",
            )}
          >
            <Feather
              name={name}
              size={18}
              color={active ? colors.foreground : colors.mutedForeground}
            />
          </Pressable>
        );
      })}
    </View>
  );
}

/* ----------------------------------------------------------------------- dialog */

/**
 * A modal panel with a title, a scrolling body and a row of buttons under it.
 *
 * The same shape as `Select`'s sheet — a scrim over the screen, a rounded panel centred on it
 * — because there is no portal layer in React Native and a `Modal` is the only way a thing on
 * top of everything else exists here. The panel is a `Pressable` that does nothing: a press
 * inside it has to be swallowed, or it reaches the scrim behind and closes the dialog on every
 * tap into a text field.
 */
export function Dialog({
  visible,
  title,
  onClose,
  children,
  footer,
}: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-center bg-black/50 p-4" onPress={onClose}>
        <Pressable
          onPress={() => {}}
          className="max-h-[88%] w-full max-w-xl self-center overflow-hidden rounded-xl border border-border bg-popover"
        >
          <View className="flex-row items-center gap-2 border-b border-border px-4 py-3">
            <Text className="flex-1 text-base font-semibold text-popover-foreground">{title}</Text>
            <Button
              variant="ghost"
              size="icon"
              icon="x"
              accessibilityLabel="Close"
              onPress={onClose}
            />
          </View>
          <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
            {children}
          </ScrollView>
          {footer ? (
            <View className="flex-row items-center gap-2 border-t border-border px-4 py-3">
              {footer}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
