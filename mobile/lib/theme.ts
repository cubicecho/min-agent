import { useColorScheme } from "react-native";

/**
 * The palette again, in TypeScript. React Native props that take a colour — icon
 * tints, `placeholderTextColor`, the navigator's own chrome — are plain strings and
 * cannot read a CSS variable, so those values live here as well as in `global.css`.
 * The two must be changed together.
 */
const LIGHT = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondaryForeground: "#171717",
  destructive: "#e7000b",
  border: "#e5e5e5",
};

const DARK: typeof LIGHT = {
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

export type Colors = typeof LIGHT;

export const useColors = (): Colors => (useColorScheme() === "dark" ? DARK : LIGHT);
