import { createTestDb } from "./db.ts";

/**
 * What a database test puts in place of `server/db/client.ts`.
 *
 * The server reads one module-level `db` instead of being handed one, so there is nowhere to
 * pass a test database in. Swapping the module is the seam until there is
 * (cubicecho/min-agent#88): a file that needs the database writes
 * `vi.mock("<path>/server/db/client.ts", () => import("<path>/db-client.ts"))`, and everything
 * it imports from the server then talks to this one. Each test file has its own module graph,
 * so each gets its own database.
 */
export const db = await createTestDb();
