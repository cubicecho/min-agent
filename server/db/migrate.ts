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
 * self-hosted app: `docker compose up` on a new machine is the whole install. Two servers
 * booting at once would both try, but Postgres serialises the attempt and the loser finds
 * nothing left to do.
 */
export async function runMigrations() {
  await migrate(db, { migrationsFolder: path.join(ROOT, "drizzle") });

  // The settings row is a singleton the UI edits in place, so it has to exist before the UI
  // can load. Seeding it in code rather than in the migration keeps it true for a database
  // that was migrated before this row was a thing; column defaults fill the rest in.
  await db.insert(settings).values({ id: "default" }).onConflictDoNothing();
}
