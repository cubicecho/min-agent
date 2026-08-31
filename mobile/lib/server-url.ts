import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const KEY = "min-agent.server-url";

/**
 * A page served by the agent itself can just use its own origin. Everywhere else has
 * to be told an address: Android, and Electron — which also runs over http, but from
 * its own bundled static server rather than from the agent.
 */
const inElectron = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent);

const servedByAgent =
  Platform.OS === "web" &&
  !inElectron &&
  typeof location !== "undefined" &&
  location.protocol.startsWith("http");

export const DEFAULT_SERVER_URL = servedByAgent ? "" : "http://localhost:8787";

/** Trailing slashes and a pasted `/api` suffix are the two mistakes worth absorbing. */
export const normalizeServerUrl = (value: string) =>
  value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

let current = DEFAULT_SERVER_URL;

/** Read synchronously so the API client can build a URL without awaiting storage. */
export const serverUrl = () => current;

export async function loadServerUrl() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  if (stored !== null) current = stored;
  return current;
}

export async function setServerUrl(value: string) {
  current = normalizeServerUrl(value);
  await AsyncStorage.setItem(KEY, current);
  return current;
}
