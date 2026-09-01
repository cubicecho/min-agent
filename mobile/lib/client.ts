import { createClient } from "@shared/client/api.ts";
import { createVoiceClient } from "@shared/client/voice.ts";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import { serverUrl } from "./server-url.ts";

/**
 * React Native's built-in `fetch` resolves the whole body before returning, which
 * would turn the turn stream into one lump at the end. `expo/fetch` gives a real
 * `ReadableStream`; on web the platform's own fetch already does.
 */
export const { api, streamTurn } = createClient({
  baseUrl: () => `${serverUrl()}/graphql`,
  fetch: Platform.OS === "web" ? undefined : (expoFetch as unknown as typeof globalThis.fetch),
});

/**
 * Voice is the one thing not on the GraphQL endpoint, so it is built from the origin rather
 * than from `/graphql` — see `shared/client/voice.ts`. The platform's own `fetch` on both
 * sides: neither call streams, and `expo/fetch` has no `arrayBuffer` to read the audio out of.
 */
export const voice = createVoiceClient({ baseUrl: serverUrl });
