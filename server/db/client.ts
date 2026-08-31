import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DATABASE_URL } from "../paths.ts";
import { relations } from "./schema.ts";

/**
 * The one connection to Postgres. Everything above this file imports `db` and nothing else,
 * so the driver and the connection string are named in exactly one place.
 *
 * `pg`'s pool connects lazily, so importing this costs nothing: a build step that only needs
 * the table definitions — printing the GraphQL schema, say — never opens a socket.
 */
export const db = drizzle({ connection: DATABASE_URL, relations });

export type Db = typeof db;

/** Roughly half a minute of trying, backing off 250ms, 500ms, 1s… to a 4s ceiling. */
const ATTEMPTS = 12;
const CEILING_MS = 4_000;

/**
 * Waits for the database to answer before anything tries to use it.
 *
 * A server started beside its database wins that race about as often as it loses it —
 * `docker compose` waits for the healthcheck, but a bare `npm start`, a `systemctl restart`
 * or a host reboot does not, and Postgres takes a few seconds to accept connections after
 * the process exists. Crashing on the first refused socket turns a normal ordering into an
 * outage that needs a human, so this retries instead and only gives up if it stays down.
 *
 * The wait is bounded on purpose: a wrong `DATABASE_URL` should fail the boot with the
 * driver's own error rather than hang forever looking like a slow start.
 */
export async function waitForDatabase() {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql`select 1`);
      return;
    } catch (error) {
      if (attempt >= ATTEMPTS) throw error;
      const delay = Math.min(CEILING_MS, 125 * 2 ** attempt);
      // Drizzle's message carries the failed query and its params across several lines, which
      // is noise in a line that repeats. The driver's own reason is the first one.
      const [reason] = String((error as Error).cause ?? (error as Error).message).split("\n");
      console.warn(
        `database not ready (${reason}); retrying in ${delay}ms [${attempt}/${ATTEMPTS - 1}]`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
