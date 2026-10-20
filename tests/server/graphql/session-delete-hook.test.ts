import { graphql } from "graphql";
import { createSettings } from "../../../server/config.ts";
import { createSchema } from "../../../server/graphql/schema.ts";
import { HOST } from "../../../server/hooks.ts";
import { createMcp } from "../../../server/mcp.ts";
import { createStore } from "../../../server/store.ts";
import { closeTestDb, createTestDb, resetTestDb } from "../db.ts";

/**
 * Deleting a chat tells the MCP servers' `sessionDelete` hooks, so a memory server can forget it.
 *
 * This needs a database because the delete that matters is the generated one. The app deletes
 * a chat through `deleteSessionSingle`, which never goes near `store.ts`. The only place that
 * sees it is the sessions `onWrite` hook in `graphql/schema.ts`, and that is what this pins.
 */
/** The pool's hook runner, which is where a delete reaches the servers. It runs none here. */
const runHooks = vi.fn(async () => []);
const db = await createTestDb();
const store = createStore(db);
const schema = createSchema({
  db,
  mcp: { ...createMcp(), runHooks },
  store,
  settings: createSettings(db),
});

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
    runHooks.mockClear();
  });

  afterAll(() => closeTestDb(db));

  it("fires sessionDelete with the id of the chat that went", async () => {
    const session = await store.createSession({ title: "forget me" });

    const result = await remove(session.id);

    expect(result.errors).toBeUndefined();
    expect(runHooks).toHaveBeenCalledExactlyOnceWith(
      "sessionDelete",
      { session: { id: session.id }, host: HOST },
      expect.anything(),
    );
  });

  it("fires nothing for a delete that matched no chat", async () => {
    const result = await remove("no-such-session");

    expect(result.errors).toBeUndefined();
    expect(runHooks).not.toHaveBeenCalled();
  });
});
