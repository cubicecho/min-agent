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

let fallback = "";

/** What an install with nothing saved will talk to. Resolved by `loadServerUrl`. */
export const defaultServerUrl = () => fallback;

/** Trailing slashes and a pasted `/graphql` suffix are the two mistakes worth absorbing. */
export const normalizeServerUrl = (value: string) =>
  value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/graphql$/, "");

/**
 * Baked in at bundle time by `scripts/expo.ts`, from the same `.env` the server reads, so
 * moving the server with `PORT` does not also mean editing this app. Guessing 8787 was
 * wrong in the one case that matters: a server that has moved, on a machine where 8787 is
 * now something else entirely, which answers and is not the agent. Written out in full
 * because Expo substitutes the whole expression at build time — it is not a lookup, so it
 * cannot be destructured or built up from parts.
 */
const configured = normalizeServerUrl(process.env.EXPO_PUBLIC_AGENT_URL ?? "");

let current = fallback;

/** Read synchronously so the API client can build a URL without awaiting storage. */
export const serverUrl = () => current;

/**
 * Being on the web is not the same as having been served by the agent. `expo start --web`
 * serves the app from Metro, and Metro answers every path it does not recognise with
 * `index.html` — so an origin-relative `/graphql` comes back as `<!DOCTYPE html>` and every
 * screen fails on a JSON parse. Whether the origin actually speaks GraphQL is a question with
 * an answer, so it is asked once here rather than inferred from the protocol.
 */
async function originServesTheApi() {
  try {
    const response = await fetch("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ query: "{ health { ok } }" }),
    });
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

  // Nothing saved. The origin is worth trying first and cheap to rule out: served by the
  // agent itself, it is right even when the address baked in at build time names a host
  // this device cannot reach. Then the build-time address, then a guess.
  if (onWeb && (await originServesTheApi())) {
    fallback = "";
  } else if (configured) {
    fallback = configured;
  } else if (onWeb) {
    fallback = `${location.protocol}//${location.hostname}:${AGENT_PORT}`;
  } else {
    fallback = `http://localhost:${AGENT_PORT}`;
  }

  current = fallback;
  return current;
}

export async function setServerUrl(value: string) {
  current = normalizeServerUrl(value);
  await AsyncStorage.setItem(KEY, current);
  return current;
}
