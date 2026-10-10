import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * How much the forms on this device explain themselves.
 *
 * Kept on the device, beside the dictation settings and for the same reason: whether the line
 * under every box is help or clutter is about who is holding the thing and how much room it
 * has, and the phone and the desktop may answer differently.
 */

const KEY = "min-agent.display";

export interface DisplaySettings {
  /**
   * Draw each field's and each card's description where it stands. Off puts it behind an
   * info button beside the label instead.
   */
  showDescriptions: boolean;
}

const DEFAULTS: DisplaySettings = { showDescriptions: true };

let current: DisplaySettings = DEFAULTS;
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) {
    listener();
  }
};

/** Read synchronously, for the callers that are not components. */
export const displaySettings = () => current;

/**
 * Awaited before the app renders, like the server address, so the first settings panel is
 * drawn the way it was left rather than drawn in full and then folded.
 */
export async function loadDisplaySettings() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  try {
    if (stored) {
      const saved = JSON.parse(stored) as Partial<DisplaySettings>;
      // Anything but a stored `false` is the default: shown.
      current = { showDescriptions: saved.showDescriptions !== false };
    }
  } catch {
    // Something that will not parse was written by a version that stored something else.
    // The defaults are a better answer to that than a crash on the first frame.
  }
  announce();
  return current;
}

export async function setDisplaySettings(change: Partial<DisplaySettings>) {
  current = { showDescriptions: change.showDescriptions ?? current.showDescriptions };
  // Told before it is written, as the dictation settings are: a failed write is not a reason
  // to refuse the setting for this run.
  announce();
  await AsyncStorage.setItem(KEY, JSON.stringify(current)).catch(() => {});
  return current;
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The settings, in a component, redrawn wherever they are shown when they change. */
export const useDisplaySettings = () =>
  useSyncExternalStore(subscribe, displaySettings, displaySettings);
