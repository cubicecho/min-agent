import path from "node:path";
import { fileURLToPath } from "node:url";
import manifest from "../package.json" with { type: "json" };
import { DISCOVERY_DEFAULTS, SERVER_DEFAULTS } from "../shared/defaults.ts";

const here = path.dirname(fileURLToPath(import.meta.url));

export const ROOT = path.resolve(here, "..");
export const PORT = Number(process.env.PORT ?? SERVER_DEFAULTS.port);

/**
 * What min-agent calls itself when something asks — currently the `clientInfo` an MCP server is
 * handed on connect, which is the whole of what a dialled server learns about who is calling it.
 *
 * Read from the manifest rather than written down again: releases are cut by semantic-release,
 * which bumps `package.json` and nothing else, so a second copy would be stale by the next one.
 * The Dockerfile copies the manifest into the runtime image beside `server/`, so the import
 * resolves there the same way it does on the host.
 */
export const VERSION = manifest.version;

/**
 * Postgres holds everything: the settings the Config tab edits, the MCP servers, and every
 * session with its messages. There is no file store and no SQLite fallback — `docker compose
 * up` brings a database with it, and `.env.example` has the URL for a local one.
 */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://min_agent:min_agent@localhost:5432/min_agent";

// Binding every interface is the default because the Android and desktop apps reach this
// server across the LAN, and `listen(PORT)` on its own already did that. Set HOST to
// `localhost` to take that back and accept local connections only — worth doing on a
// network you do not trust, since nothing here is authenticated.
export const HOST = process.env.HOST ?? "0.0.0.0";

/** A wildcard bind is not an address anything can connect to, so show one that is. */
export const displayHost = (host = HOST) =>
  host === "0.0.0.0" || host === "::" ? "localhost" : host;

/**
 * An on/off environment variable: `true`/`1`/`on`/`yes` or `false`/`0`/`off`/`no`, any case.
 *
 * @param value - The variable as the environment holds it.
 * @param fallback - What unset, or anything else, means.
 * @returns The flag.
 */
export function envFlag(value: string | undefined, fallback: boolean): boolean {
  const word = (value ?? "").trim().toLowerCase();
  if (["true", "1", "on", "yes"].includes(word)) {
    return true;
  }
  if (["false", "0", "off", "no"].includes(word)) {
    return false;
  }
  return fallback;
}

/** Whether to watch the LAN for MCP servers to suggest on the MCP tab. See `DISCOVERY_DEFAULTS`. */
export const MCP_DISCOVERY = envFlag(process.env.MCP_DISCOVERY, DISCOVERY_DEFAULTS.enabled);
