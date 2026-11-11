import { graphql } from "graphql";
import { createSettings } from "../../../server/config.ts";
import { createSchema } from "../../../server/graphql/schema.ts";
import { createInbox } from "../../../server/inbox.ts";
import { createMcp } from "../../../server/mcp.ts";
import { createStore } from "../../../server/store.ts";
import { SteerTurnDocument } from "../../../shared/gql/graphql.ts";
import { closeTestDb, createTestDb } from "../db.ts";

/** `steerTurn` hands what was typed to the chat's running turn, through the inbox the turns share. */
const db = await createTestDb();
const inbox = createInbox();
const schema = createSchema({
  db,
  mcp: createMcp(),
  store: createStore(db),
  settings: createSettings(db),
  inbox,
});

const steer = (sessionId: string, text: string) =>
  graphql({
    schema,
    source: SteerTurnDocument.toString(),
    variableValues: { sessionId, id: "m1", text },
  });

describe("steerTurn", () => {
  afterAll(() => closeTestDb(db));

  it("hands the message to the turn running in that chat", async () => {
    const turn = inbox.open("s1");
    const result = await steer("s1", "and /b");
    expect(result).toEqual({ data: { steerTurn: true } });
    expect(turn.take()).toEqual({ ids: ["m1"], text: "and /b" });
    turn.close();
  });

  it("answers false where no turn can take it", async () => {
    expect(await steer("s2", "anyone?")).toEqual({ data: { steerTurn: false } });
  });

  it("refuses a message with nothing in it", async () => {
    const turn = inbox.open("s1");
    const result = await steer("s1", "   ");
    expect(result.errors?.[0]?.message).toBe("A message to steer a turn with needs some text.");
    expect(turn.take()).toBeUndefined();
    turn.close();
  });
});
