import { useEffect, useRef } from "react";
import { Platform } from "react-native";

/**
 * Keyboard shortcuts, in the builds that have a keyboard.
 *
 * One `keydown` listener for the whole app rather than one per screen: a shortcut is a
 * property of the window, and screens come and go under it. Components declare what they
 * answer to with `useShortcut` and the listener does the dispatching, which also means the
 * bindings are undone by unmounting rather than by remembering to.
 *
 * Everything here is web-only — the Electron build is the web build, and a phone has no
 * keyboard to bind. On native the hook registers nothing and costs a `Platform.OS` check.
 */

type Handler = () => void;

/**
 * Handlers by combo, most recently mounted last, and only the last one runs.
 *
 * Escape is why it is a stack: a dialog opened over a screen that already answers to Escape
 * should be what closes, and it should hand the key back when it goes.
 */
const bound = new Map<string, Handler[]>();

/** Normalised so `Ctrl` and `Cmd` are the same key to bind against, which is what people mean. */
function comboOf(event: KeyboardEvent): string {
  const mod = event.metaKey || event.ctrlKey ? "mod+" : "";
  const shift = event.shiftKey ? "shift+" : "";
  const alt = event.altKey ? "alt+" : "";
  return `${mod}${shift}${alt}${event.key.toLowerCase()}`;
}

/** A box someone is typing in, where a bare letter is a letter and nothing else. */
function typing(target: EventTarget | null): boolean {
  const node = target as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || node.isContentEditable;
}

function onKeyDown(event: KeyboardEvent) {
  // A held key is one shortcut, and something that has already been handled is not ours.
  if (event.defaultPrevented || event.repeat) return;

  const combo = comboOf(event);
  const stack = bound.get(combo);
  const handler = stack?.[stack.length - 1];
  if (!handler) return;

  // A chord is unambiguous wherever the caret is — ⌘K while writing a message is exactly
  // when you want it — and Escape in a text box is the whole point of Escape. A bare key
  // is not: in a text box it is what the person is typing.
  if (!combo.startsWith("mod+") && combo !== "escape" && typing(event.target)) return;

  event.preventDefault();
  handler();
}

let listening = false;

/** The listener exists exactly while something is bound to it, and no longer. */
function sync() {
  const wanted = bound.size > 0;
  if (wanted === listening) return;
  listening = wanted;
  if (wanted) document.addEventListener("keydown", onKeyDown);
  else document.removeEventListener("keydown", onKeyDown);
}

/**
 * Answers `combo` for as long as this component is mounted, and only while `handler` is
 * given — pass `undefined` for a shortcut that is not currently available, rather than
 * binding a key to nothing and swallowing it.
 *
 * The handler is read through a ref, so a closure that changes every render does not
 * re-register the binding and reorder the stack under a dialog.
 */
export function useShortcut(combo: string, handler: Handler | undefined | null) {
  const latest = useRef(handler);
  latest.current = handler;

  const armed = Platform.OS === "web" && Boolean(handler);

  useEffect(() => {
    if (!armed) return;
    const run = () => latest.current?.();

    let stack = bound.get(combo);
    if (!stack) {
      stack = [];
      bound.set(combo, stack);
    }
    stack.push(run);
    sync();

    return () => {
      const at = stack.indexOf(run);
      if (at >= 0) stack.splice(at, 1);
      if (!stack.length) bound.delete(combo);
      sync();
    };
  }, [combo, armed]);
}
