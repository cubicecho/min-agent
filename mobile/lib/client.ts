import { createClient } from "@shared/client/api.ts";
import { createVoiceClient } from "@shared/client/voice.ts";
import { fetch as expoFetch } from "expo/fetch";
import { Platform } from "react-native";
import { needsServerUrl, serverUrl } from "./server-url.ts";

/**
 * The address, or the reason there isn't one.
 *
 * A downloaded build is handed no default — see `server-url.ts` — so until someone fills
 * in Settings → Server there is nowhere to send this. Saying that is the whole job: the
 * alternative is a relative `/graphql` posted from a device, which fails somewhere in the
 * networking stack under a name that has nothing to do with the setting that fixes it.
 * Every screen already renders a query error beside a link to that panel.
 */
function base() {
  if (needsServerUrl()) {
    throw new Error("No server address yet. Set one under Settings → Server.");
  }
  return serverUrl();
}

/**
 * React Native's built-in `fetch` resolves the whole body before returning, which
 * would turn the turn stream into one lump at the end. `expo/fetch` gives a real
 * `ReadableStream`; on web the platform's own fetch already does.
 */
export const { api, streamTurn } = createClient({
  baseUrl: () => `${base()}/graphql`,
  fetch: Platform.OS === "web" ? undefined : (expoFetch as unknown as typeof globalThis.fetch),
});

/**
 * Voice is the one thing not on the GraphQL endpoint, so it is built from the origin rather
 * than from `/graphql` — see `shared/client/voice.ts`. The platform's own `fetch` on both
 * sides: neither call streams, and `expo/fetch` has no `arrayBuffer` to read the audio out of.
 */
export const voice = createVoiceClient({ baseUrl: base });
