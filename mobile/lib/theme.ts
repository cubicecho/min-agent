/**
 * The palette again, in TypeScript. React Native props that take a colour — icon
 * tints, `placeholderTextColor`, the navigator's own chrome — are plain strings and
 * cannot read a CSS variable, so those values live here as well as in `global.css`.
 * The two must be changed together.
 *
 * There is only the dark set, because the web app is dark and has no switch.
 */
export const colors = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  muted: "#262626",
  mutedForeground: "#a1a1a1",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  secondaryForeground: "#fafafa",
  destructive: "#ff6467",
  border: "rgba(255,255,255,0.12)",
};

export type Colors = typeof colors;
