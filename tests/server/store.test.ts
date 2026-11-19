import { sql } from "drizzle-orm";
import { createStore } from "../../server/store.ts";
import { closeTestDb, createTestDb, resetTestDb } from "./db.ts";

/**
 * The store is Postgres, so testing it means talking to one: PGlite, in this process.
 */
const db = await createTestDb();
const store = createStore(db);

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
    const counted: { rows: { count: number }[] } = await db.execute(
      sql`select count(*)::int as count from messages`,
    );
    const [{ count }] = counted.rows;
    expect(count).toBe(0);
  });

  it("keeps the model's transcript and its ledger, and reads back none where none was stored", async () => {
    const session = await store.createSession();
    const read = async () => await store.getSession(session.id);
    expect((await read())?.transcript).toBeUndefined();
    expect((await read())?.ledger).toBeUndefined();

    const transcript = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "Hello." },
    ];
    const ledger = [{ through: 0, prompt: 100, epoch: 0 }];
    await store.updateSession(session.id, { transcript, ledger });
    expect((await read())?.transcript).toEqual(transcript);
    expect((await read())?.ledger).toEqual(ledger);

    await store.updateSession(session.id, { transcript: null });
    expect((await read())?.transcript).toBeUndefined();
  });

  it("forgets the transcript and its ledger at a cut, for the next turn to rebuild", async () => {
    const session = await store.createSession();
    for (let idx = 0; idx < 6; idx++) {
      await store.addMessage(session.id, idx, { role: "user", content: `message ${idx}` });
    }
    await store.updateSession(session.id, {
      transcript: [{ role: "user", content: "message 0" }],
      ledger: [{ through: 0, prompt: 100, epoch: 0 }],
    });

    await store.truncateSession(session.id, 3);
    const cut = await store.getSession(session.id);
    expect(cut?.transcript).toBeUndefined();
    expect(cut?.ledger).toBeUndefined();
    expect(cut?.messages).toHaveLength(3);
  });

  it("stores the hooks' context on a question after the question", async () => {
    const session = await store.createSession();
    const id = await store.addMessage(session.id, 0, { role: "user", content: "hi" });
    await store.patchMessage(id, { hook_context: "<context>tea</context>" });
    const [question] = (await store.getSession(session.id))?.messages ?? [];
    expect(question).toEqual({
      role: "user",
      content: "hi",
      hook_context: "<context>tea</context>",
    });
  });

  it("returns null for a session that is not there", async () => {
    expect(await store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
