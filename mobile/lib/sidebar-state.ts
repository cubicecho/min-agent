import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * Whether the wide window's sidebar is folded down to its rail of icons.
 *
 * Kept on the device, beside the display settings and for the same reason: how much room the
 * nav may take is about the screen it is drawn on, and the desktop and the tablet may answer
 * differently. A narrow window draws the bar instead, folded or not.
 */

const KEY = "min-agent.sidebar";

interface SidebarState {
  /** Folded to the rail of icons rather than drawn at full width. */
  collapsed: boolean;
}

const DEFAULTS: SidebarState = { collapsed: false };

let current: SidebarState = DEFAULTS;
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) {
    listener();
  }
};

const isCollapsed = () => current.collapsed;

/**
 * Awaited before the app renders, like the display settings, so a sidebar left folded is
 * drawn folded on the first frame rather than drawn open and then folded.
 */
export async function loadSidebarState() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  try {
    if (stored) {
      const saved: { collapsed?: unknown } = JSON.parse(stored);
      current = { collapsed: saved.collapsed === true };
    }
  } catch {
    // Something that will not parse was written by a version that stored something else.
    // Open is a better answer to that than a crash on the first frame.
  }
  announce();
  return current;
}

/** Folds or opens the sidebar, and remembers the choice on this device. */
export async function setSidebarCollapsed(collapsed: boolean) {
  current = { collapsed };
  // Told before it is written: the sidebar should fold under the press, and a failed write is
  // not a reason to refuse the choice for this run.
  announce();
  await AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Whether the sidebar is folded, redrawn when it is folded or opened. */
export const useSidebarCollapsed = () => useSyncExternalStore(subscribe, isCollapsed, isCollapsed);
