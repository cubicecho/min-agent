import { PGlite } from "@electric-sql/pglite";
import { getTableName, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { inject } from "vitest";
import { relations, schema, settings } from "../../server/db/schema.ts";

/**
 * The database the store and the generated schema are tested against: a real Postgres, in
 * this process, with nothing to install and nothing to point at.
 *
 * A file boots one in `beforeAll` (by importing `db`, see `db-client.ts`), empties it with
 * `resetTestDb` before each test, and closes it with `closeTestDb` when it is done. Booting
 * one is the expensive part, which is why it is not done per test.
 */

/**
 * A drizzle db over PGlite.
 *
 * PGlite's client runs the same queries as the node-postgres one the server's `Db` names,
 * but it is a different type. This alias is the one place that gap is bridged.
 */
// biome-ignore lint/suspicious/noExplicitAny: see the comment above
export type TestDb = any;

declare module "vitest" {
  interface ProvidedContext {
    /** The DDL for the tables as they are now, worked out once per run by `global-setup.ts`. */
    schemaSql: string[];
  }
}

/** Every table, quoted for a statement that names them all. */
const TABLE_LIST = Object.values(schema)
  .map((table) => `"${getTableName(table)}"`)
  .join(", ");

/**
 * @returns A fresh in-memory Postgres with the tables in it and nothing in them.
 */
export async function createTestDb(): Promise<TestDb> {
  const client = new PGlite("memory://");
  for (const statement of inject("schemaSql")) {
    await client.exec(statement);
  }
  return drizzle({ client, relations });
}

/**
 * Empties every table and puts back the settings row, so the next test starts from the
 * database a first boot leaves: `runMigrations` seeds that row, and the app cannot load
 * without it.
 * @param db The test db.
 */
export async function resetTestDb(db: TestDb): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE TABLE ${TABLE_LIST} RESTART IDENTITY CASCADE`));
  await db.insert(settings).values({ id: "default" });
}

/**
 * Shuts a test db down. One left open holds its whole Postgres in memory until the worker
 * exits.
 * @param db The test db.
 */
export async function closeTestDb(db: TestDb): Promise<void> {
  await db.$client.close();
}
