import { useEffect, useRef, useState } from "react";
import { Platform, TextInput, type TextInputProps } from "react-native";
import { colors } from "@/lib/theme.ts";
import { cn } from "@/lib/utils.ts";

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
 * The box a message is typed in.
 *
 * App-owned, and not cubeui's `Textarea`, for the two things a composer does that a form's
 * text area does not: it is exactly as tall as what is in it, and in a browser a bare Enter
 * sends. It wears the same tokens as cubeui's, so it reads as the same control.
 *
 * `onSubmit` is deliberately web-only: on a phone the return key is how you get a new line,
 * and there is a send button an inch away.
 */
export function ComposerInput({
  value,
  onChangeText,
  onSubmit,
  placeholder,
  label,
  className,
}: {
  value: string;
  onChangeText: (text: string) => void;
  onSubmit: () => void;
  placeholder?: string;
  /** The box's accessible name; a placeholder is not one. */
  label: string;
  className?: string;
}) {
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
    if (Platform.OS !== "web") return;
    const node = box.current as unknown as HTMLTextAreaElement | null;
    if (!node) return;
    const style = getComputedStyle(node);
    const border = parseFloat(style.borderTopWidth) + parseFloat(style.borderBottomWidth);
    node.style.height = "0px";
    const measured = node.scrollHeight + border;
    node.style.height = "";
    setHeight(measured);
  }, [value]);

  return (
    <TextInput
      ref={box}
      multiline
      textAlignVertical="top"
      aria-label={label}
      // A browser defaults a `<textarea>` to two rows, and react-native-web passes no `rows`
      // of its own unless told to — so the box stood two lines tall before it held anything,
      // and no `min-h-*` could bring it down. The cast is because `rows` is one of the DOM
      // props react-native-web accepts and React Native's types do not carry.
      {...({ rows: 1 } as TextInputProps)}
      // Native reports a true content height and needs none of the web's care above.
      onContentSizeChange={
        Platform.OS !== "web"
          ? (event) => setHeight(event.nativeEvent.contentSize.height)
          : undefined
      }
      style={height ? { height } : null}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.mutedForeground}
      onKeyPress={(event) => {
        if (Platform.OS !== "web") return;
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
        "rounded-md border border-input bg-background px-3 text-foreground text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    />
  );
}
