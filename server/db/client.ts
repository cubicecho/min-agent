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
