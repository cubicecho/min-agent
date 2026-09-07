import path from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { ROOT } from "../paths.ts";
import { db } from "./client.ts";
import { settings } from "./schema.ts";

/**
 * Applies the migrations in `drizzle/` on boot, so a fresh clone runs with no separate step.
 *
 * They are generated, not hand-written: change `schema.ts`, run `npm run db:generate`, and
 * commit the SQL it produces alongside it. Drizzle records what it has applied in its own
 * table, so this is a no-op on an up-to-date database and safe to run on every start.
 *
 * Running it here rather than as a deploy step is a deliberate trade for a single-instance
 * self-hosted app: `docker compose up` on a new machine is the whole install. Two of them
 * booting at once both try, which `RACED` below is about.
 */
export async function runMigrations() {
  await withoutRacing(() => migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") }));

  // The settings row is a singleton the UI edits in place, so it has to exist before the UI
  // can load. Seeding it in code rather than in the migration keeps it true for a database
  // that was migrated before this row was a thing; column defaults fill the rest in.
  await db.insert(settings).values({ id: "default" }).onConflictDoNothing();
}

/**
 * Postgres codes for "someone else created it while I was creating it".
 *
 * `CREATE TABLE IF NOT EXISTS` is not atomic — the existence check and the create are separate,
 * and two connections that pass the check together both go on to create. What comes back is a
 * duplicate on the catalogue's own unique index rather than anything about the table, which is
 * why this is a set of codes and not a message match.
 */
const RACED = new Set([
  "23505", // unique_violation, on pg_type/pg_class while creating
  "42P07", // duplicate_table
  "42710", // duplicate_object, for a constraint or index
]);

/** Enough to outlast a migration that is mid-flight, and few enough to fail a real error fast. */
const ATTEMPTS = 4;

/** Every code down an error's chain — drizzle wraps the driver's error in its own. */
const codes = (error: unknown): string[] =>
  error instanceof Error
    ? [String((error as { code?: unknown }).code ?? ""), ...codes(error.cause)]
    : [];

/**
 * Runs the migration, and retries if another migrator was inside it at the same time.
 *
 * The loser of that race has nothing left to do — the winner's transaction has applied
 * everything and recorded it — so the retry is a second pass that finds the work done. Two
 * servers booting together is the case in production; two test files that each need a schema
 * is the case that found this, and both used to fail the boot on a fresh database.
 */
async function withoutRacing<T>(migration: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await migration();
    } catch (error) {
      if (attempt >= ATTEMPTS || !codes(error).some((code) => RACED.has(code))) throw error;
      console.warn(`migrations: another migrator got there first; retrying [${attempt}]`);
      await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
    }
  }
}
