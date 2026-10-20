import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { DATABASE_DEFAULTS } from "../../shared/defaults.ts";
import { messageOf } from "../../shared/errors.ts";
import { relations } from "./schema.ts";

/**
 * A connection pool to Postgres, so the driver is named in exactly one place. `server/index.ts`
 * builds the one the process runs on and hands it to everything that reads or writes a table.
 *
 * `pg`'s pool connects lazily, so building one costs nothing: a build step that only needs the
 * table definitions — printing the GraphQL schema, say — never opens a socket.
 *
 * @param url - The connection string, `DATABASE_URL`.
 * @returns The database.
 */
export const createDb = (url: string) => drizzle({ connection: url, relations });

/** A database the server reads and writes through: the process's, or a test's PGlite. */
export type Db = ReturnType<typeof createDb>;

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
 *
 * @param db - The database to wait for.
 * @returns Once it answers.
 */
export async function waitForDatabase(db: Db) {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql`select 1`);
      return;
    } catch (error) {
      if (attempt >= DATABASE_DEFAULTS.connectAttempts) {
        throw error;
      }
      const delay = Math.min(
        DATABASE_DEFAULTS.backoffCeilingMs,
        DATABASE_DEFAULTS.backoffBaseMs * 2 ** attempt,
      );
      // Drizzle's message carries the failed query and its params across several lines, which
      // is noise in a line that repeats. The driver's own reason is the first one.
      const cause = error instanceof Error ? error.cause : undefined;
      const [reason] = String(cause ?? messageOf(error)).split("\n");
      console.warn(
        `database not ready (${reason}); retrying in ${delay}ms [${attempt}/${DATABASE_DEFAULTS.connectAttempts - 1}]`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}
