import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const KEY = "min-agent.server-url";

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
 * An address baked in at bundle time by `scripts/expo.ts`, from the same `.env` the server
 * reads, so moving the server with `PORT` does not also mean editing this app.
 *
 * That launcher is the local development path and nothing else — an EAS build never runs
 * it, so a downloaded APK arrives with this empty and asks for an address rather than
 * shipping a guess about someone else's network. Written out in full because Expo
 * substitutes the whole expression at build time: it is not a lookup, so it cannot be
 * destructured or built up from parts.
 */
const configured = normalizeServerUrl(process.env.EXPO_PUBLIC_AGENT_URL ?? "");

let current = fallback;

/**
 * Whether the origin this page came from answered as the agent, in which case the empty
 * string means "ask it directly" rather than "nothing is set" — the same value and opposite
 * situations, which is what `needsServerUrl` is for.
 *
 * Only ever set from the probe below, never inferred from the platform: `expo start --web`
 * is a web build whose origin is Metro, and treating that as the agent is how an empty
 * address turns into `Unexpected token '<'` on every screen.
 */
let originIsAgent = false;

/** Read synchronously so the API client can build a URL without awaiting storage. */
export const serverUrl = () => current;

/**
 * True when there is nowhere to send a request. Nothing is guessed: a build that was not
 * served by the agent and was not handed an address has one thing to say, and it is
 * "tell me where the server is", not a failed query against a host picked out of the air.
 */
export const needsServerUrl = () => current === "" && !originIsAgent;

/** Whether `defaultServerUrl` is something to go back to, or just an empty box. */
export const hasDefaultServerUrl = () => fallback !== "" || originIsAgent;

/**
 * Being on the web is not the same as having been served by the agent. `expo start --web`
 * serves the app from Metro, and Metro answers every path it does not recognise with
 * `index.html` — so an origin-relative `/graphql` comes back as `<!DOCTYPE html>` and every
 * screen fails on a JSON parse. Whether the origin actually speaks GraphQL is a question with
 * an answer, so it is asked rather than inferred from the protocol.
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

/**
 * The probe, but only when its answer is going to be used: an empty address on the web is
 * the one case that turns on it. A stored absolute URL wins outright and a device has no
 * origin to ask, so neither pays for the round trip.
 */
const probeOrigin = async (value: string) => (onWeb && value === "" ? originServesTheApi() : false);

export async function loadServerUrl() {
  const stored = await AsyncStorage.getItem(KEY).catch(() => null);
  if (stored !== null) {
    current = stored;
    originIsAgent = await probeOrigin(current);
    return current;
  }

  // Nothing saved. The origin is worth trying first and cheap to rule out: served by the
  // agent itself, it is right even when the address baked in at build time names a host
  // this device cannot reach. Then that address, if the local launcher supplied one — and
  // then nothing, because the alternative is a guess, and a guess that answers is worse
  // than no answer at all. `localhost:8787` on a phone is the phone.
  originIsAgent = await probeOrigin("");
  fallback = originIsAgent ? "" : configured;

  current = fallback;
  return current;
}

export async function setServerUrl(value: string) {
  current = normalizeServerUrl(value);
  originIsAgent = await probeOrigin(current);
  await AsyncStorage.setItem(KEY, current);
  return current;
}
