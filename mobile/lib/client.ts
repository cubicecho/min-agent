import { createClient } from "@shared/client/api.ts";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import { serverUrl } from "./server-url.ts";

/**
 * React Native's built-in `fetch` resolves the whole body before returning, which
 * would turn the turn stream into one lump at the end. `expo/fetch` gives a real
 * `ReadableStream`; on web the platform's own fetch already does.
 */
export const { api, streamTurn } = createClient({
  baseUrl: () => `${serverUrl()}/api`,
  fetch: Platform.OS === "web" ? undefined : (expoFetch as unknown as typeof globalThis.fetch),
});
