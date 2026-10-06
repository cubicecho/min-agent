import { Appearance, Platform } from "react-native";
import { dark } from "@/lib/cubeui-theme.ts";

/**
 * cubeui's dark palette, for the React Native props that take a colour as a plain string —
 * `placeholderTextColor`, a `style` built at runtime — and so cannot read a CSS variable.
 * A class name is the first choice everywhere else; this is for where there is no class to give.
 *
 * Only the dark set, because the app is pinned dark: see `pinDarkAppearance`.
 */
export const colors = dark;

/**
 * Holds the app on cubeui's dark tokens whatever the device or browser prefers.
 *
 * The token sheet follows `prefers-color-scheme`, and this app has only ever had a dark look —
 * the code colours below are a dark set with no light twin. On device the override is the
 * appearance API; on web it is the `dark` class on `<html>`, which the sheet honours over the
 * media query.
 */
export function pinDarkAppearance() {
  if (Platform.OS === "web") {
    document.documentElement.classList.add("dark");
    return;
  }
  Appearance.setColorScheme("dark");
}

export type Colors = typeof colors;

/**
 * Code colours, keyed by the highlight.js scope `shared/highlight.ts` hands back.
 *
 * These are github-dark's values, which is the stylesheet this used to be, so a fence keeps
 * the palette it has always had. A scope with no entry here — and there are a hundred-odd of
 * them — simply renders as `foreground`, which is what an unhighlighted token looks like.
 */
export const syntax: Record<string, string> = {
  keyword: "#ff7b72",
  built_in: "#ffa657",
  type: "#ffa657",
  class: "#ffa657",
  literal: "#79c0ff",
  number: "#79c0ff",
  variable: "#79c0ff",
  attr: "#79c0ff",
  attribute: "#79c0ff",
  property: "#79c0ff",
  symbol: "#79c0ff",
  string: "#a5d6ff",
  regexp: "#a5d6ff",
  char: "#a5d6ff",
  subst: "#c9d1d9",
  comment: "#8b949e",
  doctag: "#8b949e",
  meta: "#8b949e",
  quote: "#8b949e",
  title: "#d2a8ff",
  function: "#d2a8ff",
  section: "#1f6feb",
  name: "#7ee787",
  tag: "#7ee787",
  "selector-tag": "#7ee787",
  "selector-class": "#ffa657",
  "selector-id": "#ffa657",
  bullet: "#f2cc60",
  addition: "#aff5b4",
  deletion: "#ffdcd7",
};
