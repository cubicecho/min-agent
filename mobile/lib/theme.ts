/**
 * The palette again, in TypeScript. React Native props that take a colour — icon
 * tints, `placeholderTextColor`, the navigator's own chrome — are plain strings and
 * cannot read a CSS variable, so those values live here as well as in `global.css`.
 * The two must be changed together.
 *
 * There is only the dark set, because the app is dark and has no switch.
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
