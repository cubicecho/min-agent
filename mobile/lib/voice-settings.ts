import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

/**
 * How dictation behaves on this device.
 *
 * Everything under **Settings → Agent** is a fact about the server, and so the same for every
 * client that talks to it. This is not that: how long a pause you leave at the end of a
 * sentence, and whether the thing in your hand should take that pause as "send it", is a fact
 * about the phone and the room it is in. The tablet on the desk may want a different answer,
 * so it is kept here — beside the server address, in this device's own storage — rather than
 * saved back to the agent.
 */

const KEY = "min-agent.voice";

export interface VoiceSettings {
  /** Send the message as soon as dictation decides you have stopped talking. */
  autoSend: boolean;
  /** How long a pause has to last before it counts as the end of what you were saying. */
  silenceMs: number;
}

/** Under half a second every breath ends the sentence, and past five you have given up waiting. */
export const SILENCE_MIN = 500;
export const SILENCE_MAX = 5000;

const DEFAULTS: VoiceSettings = { autoSend: false, silenceMs: 1500 };

const clamp = (ms: number) =>
  Number.isFinite(ms)
    ? Math.min(SILENCE_MAX, Math.max(SILENCE_MIN, Math.round(ms)))
    : DEFAULTS.silenceMs;

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
      current = { autoSend: saved.autoSend === true, silenceMs: clamp(saved.silenceMs ?? NaN) };
    }
  } catch {
    // Something that will not parse was written by a version that stored something else.
    // The defaults are a better answer to that than a crash on the first frame.
  }
  announce();
  return current;
}

export async function setVoiceSettings(change: Partial<VoiceSettings>) {
  current = {
    autoSend: change.autoSend ?? current.autoSend,
    silenceMs: clamp(change.silenceMs ?? current.silenceMs),
  };
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
