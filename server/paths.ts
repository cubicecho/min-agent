import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const CONFIG_DIR = process.env.MIN_AGENT_CONFIG_DIR ?? path.join(ROOT, "config");
export const DATA_DIR = process.env.MIN_AGENT_DATA_DIR ?? path.join(ROOT, "data");
export const SESSIONS_DIR = path.join(DATA_DIR, "sessions");
export const PORT = Number(process.env.PORT ?? 8787);

// Binding every interface is the default because the Android and desktop apps reach this
// server across the LAN, and `listen(PORT)` on its own already did that. Set HOST to
// `localhost` to take that back and accept local connections only — worth doing on a
// network you do not trust, since nothing here is authenticated.
export const HOST = process.env.HOST ?? "0.0.0.0";

/** A wildcard bind is not an address anything can connect to, so show one that is. */
export const displayHost = (host = HOST) =>
  host === "0.0.0.0" || host === "::" ? "localhost" : host;
