import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api-postgres";
import { drizzle } from "drizzle-orm/pglite";
import type { TestProject } from "vitest/node";
import { schema } from "../server/db/schema.ts";

// drizzle-kit is seconds of import and hundreds of megabytes in every process that loads it,
// so the tables are diffed once here and the test files get the SQL.

/**
 * Works out the DDL for the tables as they are now, against an empty database, and hands it
 * to the test files as `schemaSql`.
 * @param project The Vitest project whose workers read the statements.
 */
export default async function setup(project: TestProject): Promise<void> {
  const client = new PGlite("memory://");
  const { sqlStatements } = await pushSchema(schema, drizzle({ client }));
  await client.close();
  project.provide("schemaSql", sqlStatements);
}
