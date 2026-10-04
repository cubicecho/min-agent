export const light = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  popover: "#ffffff",
  popoverForeground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f5f5f5",
  secondaryForeground: "#171717",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  accent: "#f5f5f5",
  accentForeground: "#171717",
  selection: "#2563eb",
  selectionForeground: "#ffffff",
  destructive: "#e7000b",
  destructiveForeground: "#ffffff",
  border: "#e5e5e5",
  input: "#e5e5e5",
  ring: "#a1a1a1",
  sidebar: "#fafafa",
  sidebarForeground: "#0a0a0a",
  sidebarPrimary: "#171717",
  sidebarPrimaryForeground: "#fafafa",
  sidebarAccent: "#f5f5f5",
  sidebarAccentForeground: "#171717",
  sidebarBorder: "#e5e5e5",
  sidebarRing: "#a1a1a1",
} as const;

export const dark = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  cardForeground: "#fafafa",
  popover: "#262626",
  popoverForeground: "#fafafa",
  primary: "#e5e5e5",
  primaryForeground: "#171717",
  secondary: "#262626",
  secondaryForeground: "#fafafa",
  muted: "#262626",
  mutedForeground: "#a1a1a1",
  accent: "#404040",
  accentForeground: "#fafafa",
  selection: "#60a5fa",
  selectionForeground: "#0a0a0a",
  destructive: "#ff6467",
  destructiveForeground: "#0a0a0a",
  border: "rgba(255, 255, 255, 0.1)",
  input: "rgba(255, 255, 255, 0.15)",
  ring: "#737373",
  sidebar: "#171717",
  sidebarForeground: "#fafafa",
  sidebarPrimary: "#1447e6",
  sidebarPrimaryForeground: "#fafafa",
  sidebarAccent: "#262626",
  sidebarAccentForeground: "#fafafa",
  sidebarBorder: "rgba(255, 255, 255, 0.1)",
  sidebarRing: "#737373",
} as const;

export type ColorName = keyof typeof light;
export type Palette = Record<ColorName, string>;

/**
 * Pick a palette from RN's `useColorScheme()`, which returns null before it resolves.
 *
 * Which scheme that hook reports follows the **system** appearance, because the
 * stylesheet beside this file keys its dark palette off
 * `@media (prefers-color-scheme: dark)` — the only form react-native-css honours on
 * device. An in-app theme toggle is therefore
 * `Appearance.setColorScheme("dark")` from react-native, which moves both this and
 * the stylesheet together. It is *not* a `.dark` class on a wrapper: that is the web
 * mechanism, and on native it silently styles nothing.
 */
export const palettes = {
  monokai: {
    dark: {
      background: "#272822",
      foreground: "#f8f8f2",
      card: "#2d2e27",
      cardForeground: "#f8f8f2",
      popover: "#3e3d32",
      popoverForeground: "#f8f8f2",
      primary: "#a6e22e",
      primaryForeground: "#272822",
      secondary: "#3e3d32",
      secondaryForeground: "#f8f8f2",
      muted: "#3e3d32",
      mutedForeground: "#b3ad93",
      accent: "#49483e",
      accentForeground: "#f8f8f2",
      selection: "#ae81ff",
      selectionForeground: "#272822",
      destructive: "#ff6188",
      destructiveForeground: "#272822",
      border: "#49483e",
      input: "#57564a",
      ring: "#66d9ef",
      sidebar: "#1e1f1c",
      sidebarForeground: "#f8f8f2",
      sidebarPrimary: "#ae81ff",
      sidebarPrimaryForeground: "#272822",
      sidebarAccent: "#3e3d32",
      sidebarAccentForeground: "#f8f8f2",
      sidebarBorder: "#49483e",
      sidebarRing: "#66d9ef",
    },
  },
} as const satisfies Record<string, { light?: Palette; dark?: Palette }>;

/** `default` is `light` and `dark` above; the rest are chosen in the app. */
export type PaletteName = "default" | keyof typeof palettes;

/**
 * Pick a palette from RN's `useColorScheme()`, which returns null before it resolves, and the
 * app's palette, `default` when left out.
 *
 * Which scheme that hook reports follows the **system** appearance, because the
 * stylesheet beside this file keys its dark palette off
 * `@media (prefers-color-scheme: dark)` — the only form react-native-css honours on
 * device. An in-app theme toggle is therefore
 * `Appearance.setColorScheme("dark")` from react-native, which moves both this and
 * the stylesheet together. It is *not* a `.dark` class on a wrapper: that is the web
 * mechanism, and on native it silently styles nothing.
 *
 * A palette with one mode is that mode whichever scheme is asked for.
 */
export const paletteFor = (
  scheme: "light" | "dark" | null | undefined,
  palette: PaletteName = "default",
): Palette => {
  if (palette !== "default") {
    const modes: { light?: Palette; dark?: Palette } = palettes[palette];
    const set = scheme === "dark" ? (modes.dark ?? modes.light) : (modes.light ?? modes.dark);
    if (set) return set;
  }
  return scheme === "dark" ? dark : light;
};

/**
 * A palette as the CSS variables the stylesheet declares — `--card-foreground` for
 * `cardForeground` — for NativeWind's `VariableContextProvider`, which is how a palette the
 * device's appearance knows nothing about reaches the components under it.
 */
export const cssVariables = (palette: Palette): Record<`--${string}`, string> =>
  Object.fromEntries(
    Object.entries(palette).map(([name, value]) => [
      `--${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`,
      value,
    ]),
  );
