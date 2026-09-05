import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * How dictation behaves on this device.
 *
 * Everything under **Settings → Agent** is a fact about the server, and so the same for every
 * client that talks to it. This is not that: whether the thing in your hand should send the
 * moment it decides you have stopped talking is a fact about the thing in your hand, and about
 * whether it is being held at all. The tablet on the desk may want a different answer, so it
 * is kept here — beside the server address, in this device's own storage — rather than saved
 * back to the agent.
 */

const KEY = "min-agent.voice";

export interface VoiceSettings {
  /** Send the message as soon as the microphone says it has finished. */
  autoSend: boolean;
}

const DEFAULTS: VoiceSettings = { autoSend: false };

let current: VoiceSettings = DEFAULTS;
const listeners = new Set<() => void>();

const announce = () => {
  for (const listener of listeners) listener();
};

/** Read synchronously, for the callers that are not components. */
export const voiceSettings = () => current;

/**
 * Awaited before the app renders, like the server address, so the first dictation of the
 * session already behaves the way it was left rather than the way it ships.
 */
export async function loadVoiceSettings() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  try {
    if (stored) {
      const saved = JSON.parse(stored) as Partial<VoiceSettings>;
      current = { autoSend: saved.autoSend === true };
    }
  } catch {
    // Something that will not parse was written by a version that stored something else.
    // The defaults are a better answer to that than a crash on the first frame.
  }
  announce();
  return current;
}

export async function setVoiceSettings(change: Partial<VoiceSettings>) {
  current = { autoSend: change.autoSend ?? current.autoSend };
  // Told before it is written: the switch should move under the finger, not after a round
  // trip to storage, and a failed write is not a reason to refuse the setting for this run.
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
export const useVoiceSettings = () => useSyncExternalStore(subscribe, voiceSettings, voiceSettings);
