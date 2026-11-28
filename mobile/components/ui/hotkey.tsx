import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import {
  type Chord,
  chordKeys,
  chordLabel,
  isAppleKeyboard,
  isTyping,
  type KeyPress,
  matchesChord,
} from "@/components/ui/hotkey-base";

export type { Chord, KeyPress };
export { chordKeys, chordLabel, isAppleKeyboard, isTyping, matchesChord };

/** Layers that own the keyboard while focus is in them. A tooltip is not one: it opens on hover. */
const LAYER_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** When `useHotkey` listens. */
export type HotkeyOptions = {
  /** Off, the shortcut is not listened for: a screen where its action is not available. */
  enabled?: boolean | undefined;
  /**
   * On, the shortcut fires while focus is in a field as well: a save key in an editor, or Escape,
   * whose whole job is to leave one. Off, the default, a key typed into a field is a character.
   */
  whileTyping?: boolean | undefined;
};

/**
 * Runs `handler` when `chord` is pressed, and takes the key press from the browser: `mod+s` saves
 * rather than opening the browser's own dialog. It does not fire while focus is in a field (unless
 * `whileTyping`), or inside an open dialog or menu, for a key held down, mid-composition, or for a
 * press something nearer the target already handled.
 *
 * The handler is read as of the last render, so it need not be memoized.
 *
 * @param chord - The shortcut: `mod+k`, `mod+shift+e`, `?`, `Escape`. `mod` is ⌘ or Ctrl.
 * @param handler - What the shortcut does. It is handed the key press.
 */
export function useHotkey(
  chord: Chord,
  handler: (event: KeyboardEvent) => void,
  { enabled = true, whileTyping = false }: HotkeyOptions = {},
): void {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });

  useEffect(() => {
    if (Platform.OS !== "web" || enabled === false) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      const isTaken = event.defaultPrevented || event.isComposing || event.repeat;
      if (isTaken || matchesChord(event, chord) === false) {
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      const isInLayer = target !== null && target.closest(LAYER_SELECTOR) !== null;
      const isSwallowed = isInLayer || (whileTyping === false && isTyping(target));
      if (isSwallowed) {
        return;
      }
      event.preventDefault();
      latest.current(event);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [chord, enabled, whileTyping]);
}
