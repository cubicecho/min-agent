import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * The store is Postgres now, so testing it means talking to one.
 *
 * `TEST_DATABASE_URL` has to be set on purpose, and the suite truncates every table it finds
 * there before each test — pointing it at a database you care about would be a mistake, and
 * defaulting to `DATABASE_URL` would make that mistake for you. `docker compose up postgres`
 * plus `TEST_DATABASE_URL=postgres://min_agent:min_agent@localhost:5432/min_agent_test`
 * is the intended way in; without it these tests skip and the rest of the suite still runs.
 */
const url = process.env.TEST_DATABASE_URL;

let db: typeof import("../server/db/client.ts")["db"];
let store: typeof import("../server/store.ts");

describe.skipIf(!url)("session store", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    db = (await import("../server/db/client.ts")).db;
    await (await import("../server/db/migrate.ts")).runMigrations();
    store = await import("../server/store.ts");
  });

  beforeEach(async () => {
    await db.execute(sql`truncate sessions, messages restart identity cascade`);
  });

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
    const [{ count }] = (await db.execute(sql`select count(*)::int as count from messages`))
      .rows as { count: number }[];
    expect(count).toBe(0);
  });

  it("returns null for a session that is not there", async () => {
    expect(await store.getSession("00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
