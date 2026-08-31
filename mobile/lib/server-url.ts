import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const KEY = "min-agent.server-url";

/** The port the agent listens on out of the box, and the only guess worth making. */
const AGENT_PORT = 8787;

/**
 * A page the agent itself served can just use its own origin. Everywhere else has to be
 * told an address: Android, and Electron — which also runs over http, but from its own
 * bundled static server rather than from the agent.
 */
const inElectron = typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent);

const onWeb =
  Platform.OS === "web" &&
  !inElectron &&
  typeof location !== "undefined" &&
  location.protocol.startsWith("http");

let fallback = onWeb ? "" : `http://localhost:${AGENT_PORT}`;

/** What an install with nothing saved will talk to. Resolved by `loadServerUrl`. */
export const defaultServerUrl = () => fallback;

/** Trailing slashes and a pasted `/api` suffix are the two mistakes worth absorbing. */
export const normalizeServerUrl = (value: string) =>
  value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api$/, "");

let current = fallback;

/** Read synchronously so the API client can build a URL without awaiting storage. */
export const serverUrl = () => current;

/**
 * Being on the web is not the same as having been served by the agent. `expo start --web`
 * serves the app from Metro, and Metro answers every path it does not recognise with
 * `index.html` — so an origin-relative `/api/config` comes back as `<!DOCTYPE html>` and
 * every screen fails on a JSON parse. Whether the origin actually speaks the API is a
 * question with an answer, so it is asked once here rather than inferred from the protocol.
 */
async function originServesTheApi() {
  try {
    const response = await fetch("/api/config", { headers: { accept: "application/json" } });
    return response.ok && (response.headers.get("content-type") ?? "").includes("json");
  } catch {
    return false;
  }
}

export async function loadServerUrl() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  if (stored !== null) {
    current = stored;
    return current;
  }

  // Nothing saved. On the web the origin is worth trying and cheap to rule out; the
  // agent on its default port, on whichever host served the page, is the next best guess.
  if (onWeb && !(await originServesTheApi())) {
    fallback = `${location.protocol}//${location.hostname}:${AGENT_PORT}`;
    current = fallback;
  }

  return current;
}

export async function setServerUrl(value: string) {
  current = normalizeServerUrl(value);
  await AsyncStorage.setItem(KEY, current);
  return current;
}
