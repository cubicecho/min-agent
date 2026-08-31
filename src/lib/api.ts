import { createClient } from "@shared/client/api.ts";

/** The browser build talks to its own origin; Vite proxies `/api` to the server in dev. */
export const { api, streamTurn } = createClient({ baseUrl: "/api" });
export type { TurnOptions } from "@shared/client/api.ts";
