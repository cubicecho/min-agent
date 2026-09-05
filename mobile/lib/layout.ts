import { useEffect, useState } from "react";
import { Keyboard, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * Tailwind's `md`. Above it there is room for the chat and the session list side by side,
 * which is the shape a desktop browser has room for; below it they are separate screens.
 *
 * The decision is made in JavaScript rather than with a `md:` class because it is
 * structural — which panes exist at all, and which of them a route renders — not a matter
 * of styling one. `useWindowDimensions` re-renders on rotation and on a resized browser
 * window, so the layout follows the window rather than only the width it started at.
 */
export const WIDE = 768;

export const useWide = () => useWindowDimensions().width >= WIDE;

/**
 * How much room the system bar at the foot of the screen needs.
 *
 * Android draws this app edge to edge — under the status bar and under the gesture pill or
 * the three buttons — so anything pinned to the bottom of a screen is drawn under a bar you
 * cannot tap through unless it reserves the room itself. The top is react-navigation's
 * header's problem and it already handles it; the bottom belongs to whatever is drawn last,
 * which is the composer on a chat and the scroll content everywhere else.
 *
 * It goes to zero while the keyboard is up. The window has already been resized to sit above
 * the keyboard, and the keyboard covers the bar, so the inset would no longer be clearance
 * from anything — only a gap between the composer and the keys.
 */
export function useBottomInset() {
  const { bottom } = useSafeAreaInsets();
  return useKeyboardShown() ? 0 : bottom;
}

function useKeyboardShown() {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const shows = Keyboard.addListener("keyboardDidShow", () => setShown(true));
    const hides = Keyboard.addListener("keyboardDidHide", () => setShown(false));
    return () => {
      shows.remove();
      hides.remove();
    };
  }, []);
  return shown;
}
