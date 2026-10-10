import { sql } from "drizzle-orm";
import { db } from "../../server/db/client.ts";
import * as store from "../../server/store.ts";
import { closeTestDb, resetTestDb } from "./db.ts";

/**
 * The store is Postgres, so testing it means talking to one: PGlite, in this process.
 */
vi.mock("../../server/db/client.ts", () => import("./db-client.ts"));

describe("session store", () => {
  beforeEach(() => resetTestDb(db));

  afterAll(() => closeTestDb(db));

  it("appends messages and reads them back in order", async () => {
    const session = await store.createSession({ title: "hello" });
    await store.addMessage(session.id, 0, { role: "user", content: "hi" });
    await store.addMessage(session.id, 1, { role: "assistant", content: "hello back" });

    const read = await store.getSession(session.id);
    expect(read?.messages.map((message) => message.content)).toEqual(["hi", "hello back"]);
  });

  it("keeps the message count on the session, so the list never opens a transcript", async () => {
    const session = await store.createSession({ title: "counted" });
    await store.addMessage(session.id, 0, { role: "user", content: "a long conversation" });

    const [listed] = await store.listSessions();
    expect(listed.messageCount).toBe(1);
    expect(listed).not.toHaveProperty("messages");
  });

  it("lists newest first", async () => {
    const older = await store.createSession({ title: "older" });
    await store.createSession({ title: "newer" });
    // `updatedAt` is what orders the list, and both rows were written the same millisecond.
    await store.updateSession(older.id, { title: "older" });
    await db.execute(sql`update sessions set updated_at = now() - interval '1 day'`);
    await store.createSession({ title: "newest" });

    const titles = (await store.listSessions()).map((item) => item.title);
    expect(titles[0]).toBe("newest");
  });

  it("fills in what the turn only knows at the end", async () => {
    const session = await store.createSession();
    const id = await store.addMessage(session.id, 0, { role: "assistant", content: "done" });
    await store.patchMessage(id, { followups: ["and then?"] });

    const read = await store.getSession(session.id);
    expect(read?.messages[0].followups).toEqual(["and then?"]);
  });

  it("takes the messages with the session when one is deleted", async () => {
    const session = await store.createSession();
    await store.addMessage(session.id, 0, { role: "user", content: "hi" });
    await store.deleteSession(session.id);

    expect(await store.getSession(session.id)).toBeNull();
    const counted = await db.execute<{ count: number }>(
      sql`select count(*)::int as count from messages`,
    );
    const [{ count }] = counted.rows;
    expect(count).toBe(0);
  });

  it("keeps a pruning marker, and reads back none where none was stored", async () => {
    const session = await store.createSession();
    expect((await store.getSession(session.id))?.pruning).toBeUndefined();

    const marker = { through: 4, at: "2026-01-01T00:00:00.000Z" };
    await store.updateSession(session.id, { pruning: marker });

    expect((await store.getSession(session.id))?.pruning).toEqual(marker);
  });

  it("pulls a pruning marker back to the cut, and leaves one behind it alone", async () => {
    const session = await store.createSession();
    for (let idx = 0; idx < 6; idx++) {
      await store.addMessage(session.id, idx, { role: "user", content: `message ${idx}` });
    }
    const marker = { through: 5, at: "2026-01-01T00:00:00.000Z" };
    await store.updateSession(session.id, { pruning: marker });

    // Past the cut: left there, the next results appended would arrive already cleared.
    await store.truncateSession(session.id, 3);
    expect((await store.getSession(session.id))?.pruning).toEqual({ ...marker, through: 3 });

    // Behind it: what was cleared stays cleared, so the request's prefix does not move.
    await store.updateSession(session.id, { pruning: { ...marker, through: 1 } });
    await store.truncateSession(session.id, 2);
    expect((await store.getSession(session.id))?.pruning).toEqual({ ...marker, through: 1 });
  });

  it("returns null for a session that is not there", async () => {
    expect(await store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
