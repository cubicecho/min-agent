export type Chord = string;

/** The parts of a key press a chord is matched against. */
export type KeyPress = Pick<
  KeyboardEvent,
  "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
>;

/** A chord taken apart. */
type ParsedChord = {
  key: string;
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
};

/** User agents and platforms of Apple keyboards, whose command key is ⌘. */
const APPLE = /Mac|iPhone|iPad|iPod/;
/** A key that is one letter, which a layout or Alt can turn into another character. */
const LETTER = /^[a-z]$/i;
/** A key that is one digit. */
const DIGIT = /^[0-9]$/;

/**
 * Text a key press types into: a field, a text area, a select, editable content, and the roles of
 * a widget that is a field without being one. An `<input>` that holds no text is not one: a
 * focused checkbox or button should not swallow a shortcut.
 */
const TYPING_SELECTOR = [
  'input:not([type="checkbox"], [type="radio"], [type="button"], [type="submit"], [type="reset"], [type="range"], [type="color"], [type="file"], [type="image"])',
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="searchbox"]',
].join(", ");

/** What a key is written as on its cap, where that is not the key's own name. */
const KEY_NAMES: Record<string, string> = {
  escape: "Esc",
  " ": "Space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
};

/** Takes a chord apart. `mod++` is the `+` key with ⌘ or Ctrl. */
function parseChord(chord: Chord): ParsedChord {
  const parts = chord.split("+");
  const isPlusKey = parts.at(-1) === "" && parts.length > 1;
  const key = isPlusKey ? "+" : (parts.at(-1) ?? "");
  const modifiers = new Set(parts.slice(0, isPlusKey ? -2 : -1).map((part) => part.toLowerCase()));
  return {
    key,
    mod: modifiers.has("mod"),
    ctrl: modifiers.has("ctrl"),
    alt: modifiers.has("alt"),
    shift: modifiers.has("shift"),
  };
}

/**
 * Whether this keyboard is an Apple one, so `mod` is ⌘. Read from the browser; a device and a
 * server render have no browser to ask, and are taken as not Apple.
 */
export function isAppleKeyboard(): boolean {
  if (typeof navigator === "undefined") {
    return false;
  }
  return APPLE.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);
}

/**
 * Whether a key press is the chord: its modifiers exactly, and its key. Shift is held to the
 * chord for a letter or a named key, so `mod+shift+e` and `mod+e` are two shortcuts, and not for a
 * character Shift is how you type, such as `?`. A letter or a digit also matches by where it sits
 * on the keyboard, so `mod+k` still fires on a layout whose K types another letter.
 *
 * @param apple - Whether `mod` is ⌘. The browser's keyboard when left out.
 */
export function matchesChord(
  press: KeyPress,
  chord: Chord,
  apple: boolean = isAppleKeyboard(),
): boolean {
  const wanted = parseChord(chord);
  const wantsMeta = wanted.mod && apple;
  const wantsCtrl = wanted.ctrl || (wanted.mod && apple === false);
  const isShiftTyped = wanted.key.length === 1 && LETTER.test(wanted.key) === false;
  const isModifierWrong =
    press.metaKey !== wantsMeta ||
    press.ctrlKey !== wantsCtrl ||
    press.altKey !== wanted.alt ||
    (isShiftTyped === false && press.shiftKey !== wanted.shift);
  if (isModifierWrong) {
    return false;
  }
  if (press.key.toLowerCase() === wanted.key.toLowerCase()) {
    return true;
  }
  if (LETTER.test(wanted.key)) {
    return press.code === `Key${wanted.key.toUpperCase()}`;
  }
  return DIGIT.test(wanted.key) && press.code === `Digit${wanted.key}`;
}

/**
 * Whether a key press is someone typing: its target is a text field, a text area, a select or
 * editable content, where the key means a character and not a shortcut. A checkbox or a button is
 * not typing.
 *
 * @param target - The key press's `target`.
 */
export function isTyping(target: EventTarget | null): boolean {
  const isElement = typeof Element !== "undefined" && target instanceof Element;
  return isElement && target.closest(TYPING_SELECTOR) !== null;
}

/**
 * The keys of a chord as their caps are labelled, in the order they are pressed: `["⌘", "K"]` on
 * a Mac, `["Ctrl", "Shift", "E"]` elsewhere. One `Kbd` each.
 *
 * @param apple - Whether `mod` is ⌘. The browser's keyboard when left out.
 */
export function chordKeys(chord: Chord, apple: boolean = isAppleKeyboard()): string[] {
  const { key, mod, ctrl, alt, shift } = parseChord(chord);
  // In the order each platform writes them: ⌃⌥⇧⌘ on a Mac, Ctrl Alt Shift elsewhere.
  const modifiers = apple
    ? [ctrl && "⌃", alt && "⌥", shift && "⇧", mod && "⌘"]
    : [(ctrl || mod) && "Ctrl", alt && "Alt", shift && "Shift"];
  const keys = modifiers.filter((label): label is string => typeof label === "string");
  const named = KEY_NAMES[key.toLowerCase()];
  keys.push(named ?? (key.length === 1 ? key.toUpperCase() : key));
  return keys;
}

/**
 * A chord as one short label, for a tooltip, a menu row or a button's hint: `⌘K` on a Mac, as its
 * menus write it, and `Ctrl K` elsewhere.
 *
 * @param apple - Whether `mod` is ⌘. The browser's keyboard when left out.
 */
export function chordLabel(chord: Chord, apple: boolean = isAppleKeyboard()): string {
  return chordKeys(chord, apple).join(apple ? "" : " ");
}
