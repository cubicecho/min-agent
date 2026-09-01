import { useWindowDimensions } from "react-native";

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
