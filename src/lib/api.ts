import { createClient } from "@shared/client/api.ts";

/** The browser build talks to its own origin; Vite proxies `/graphql` to the server in dev. */
export const { api, streamTurn } = createClient({ baseUrl: "/graphql" });
export type { TurnOptions } from "@shared/client/api.ts";
