import { useEffect, useState } from "react";
import { Keyboard, Platform, useWindowDimensions } from "react-native";
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
 * The room to leave under the last thing on a screen: the system bar at the foot of the
 * display, and the keyboard on top of it while it is up.
 *
 * Android draws this app edge to edge — under the status bar and under the gesture pill or
 * the three buttons — and, since Android 15, there is no opting out. Edge to edge also means
 * the window is never resized to make way for the keyboard: `adjustResize` is ignored, so a
 * `KeyboardAvoidingView` has nothing to react to and the composer stays where it was, under
 * the keys. Reserving the room is the app's job on both counts, which is what this is for.
 *
 * Called in one place: the drawer in `app/_layout.tsx` pads every scene by it, so no screen
 * has to remember to — and none can quietly forget when it is added later.
 *
 * The two numbers are added rather than picked between because on Android they measure
 * different things: the keyboard is drawn over the navigation bar, and `keyboardDidShow`
 * reports only the part of it above that bar. iOS measures its keyboard from the bottom of
 * the screen, home indicator included, so there the larger of the two is the whole of it.
 */
export function useBottomInset() {
  const { bottom } = useSafeAreaInsets();
  const keyboard = useKeyboardHeight();
  return Platform.OS === "android" ? keyboard + bottom : keyboard || bottom;
}

/** How tall the on-screen keyboard is, and zero while it is down. */
function useKeyboardHeight() {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    // iOS has the events that fire with the animation rather than after it, so the content
    // travels with the keyboard instead of jumping once it has arrived. Android only ever
    // emits the `Did` pair.
    const shown = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hidden = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const shows = Keyboard.addListener(shown, (event) =>
      setHeight(event.endCoordinates?.height ?? 0),
    );
    const hides = Keyboard.addListener(hidden, () => setHeight(0));
    return () => {
      shows.remove();
      hides.remove();
    };
  }, []);
  return height;
}
