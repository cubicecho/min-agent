import { graphql } from "graphql";
import { db } from "../../../server/db/client.ts";
import { schema } from "../../../server/graphql/schema.ts";
import * as store from "../../../server/store.ts";
import { closeTestDb, resetTestDb } from "../db.ts";

/**
 * Deleting a chat tells the MCP servers' `sessionDelete` hooks, so a memory server can forget it.
 *
 * This needs a database because the delete that matters is the generated one. The app deletes
 * a chat through `deleteSessionSingle`, which never goes near `store.ts`. The only place that
 * sees it is the sessions `onWrite` hook in `graphql/schema.ts`, and that is what this pins.
 */
const sessionDeleted = vi.hoisted(() => vi.fn());

vi.mock("../../../server/db/client.ts", () => import("../db-client.ts"));

vi.mock("../../../server/hooks.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../server/hooks.ts")>()),
  sessionDeleted,
}));

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

describe("deleting a session", () => {
  beforeEach(async () => {
    await resetTestDb(db);
    sessionDeleted.mockReset();
  });

  afterAll(() => closeTestDb(db));

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
