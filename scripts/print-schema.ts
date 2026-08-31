import fs from "node:fs";
import path from "node:path";
import { printSchema } from "graphql";
import { ROOT } from "../server/paths.ts";

/**
 * Writes the SDL to `schema.graphql` for graphql-codegen.
 *
 * The schema is generated from the Drizzle tables at runtime, so codegen has no static file to
 * read; this makes one. It needs no database — the tables describe themselves — so it runs in
 * CI and on a fresh clone. Run it whenever the tables change; `npm run codegen` does it first.
 */
const { schema } = await import("../server/graphql/schema.ts");
const file = path.join(ROOT, "schema.graphql");
fs.writeFileSync(file, printSchema(schema), "utf8");
console.log(`wrote ${path.relative(ROOT, file)}`);
process.exit(0);
