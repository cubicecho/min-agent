import type { GraphQLSchema } from "graphql";
import { graphql } from "graphql";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Deleting a chat tells the MCP servers' `sessionDelete` hooks, so a memory server can forget it.
 *
 * This needs a database because the delete that matters is the generated one. The app deletes
 * a chat through `deleteSessionSingle`, which never goes near `store.ts`. The only place that
 * sees it is the sessions `onWrite` hook in `graphql/schema.ts`, and that is what this pins.
 *
 * `TEST_DATABASE_URL` has to be set on purpose, the same as `store.test.ts`, because this
 * migrates the database it names.
 */
const url = process.env.TEST_DATABASE_URL;

const sessionDeleted = vi.fn();

vi.mock("../server/hooks.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../server/hooks.ts")>()),
  sessionDeleted,
}));

let schema: GraphQLSchema;
let store: typeof import("../server/store.ts");

const remove = (id: string) =>
  graphql({
    schema,
    source: `
      mutation DeleteSession($id: String!) {
        deleteSessionSingle(where: { id: { eq: $id } }) { id }
      }
    `,
    variableValues: { id },
  });

describe.skipIf(!url)("deleting a session", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    await (await import("../server/db/migrate.ts")).runMigrations();
    store = await import("../server/store.ts");
    schema = (await import("../server/graphql/schema.ts")).schema;
  });

  beforeEach(() => sessionDeleted.mockReset());

  it("fires sessionDelete with the id of the chat that went", async () => {
    const session = await store.createSession({ title: "forget me" });

    const result = await remove(session.id);

    expect(result.errors).toBeUndefined();
    expect(sessionDeleted).toHaveBeenCalledExactlyOnceWith(session.id);
  });

  it("fires nothing for a delete that matched no chat", async () => {
    const result = await remove("no-such-session");

    expect(result.errors).toBeUndefined();
    expect(sessionDeleted).not.toHaveBeenCalled();
  });
});
