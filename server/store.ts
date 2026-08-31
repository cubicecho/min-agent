import { asc, desc, eq, sql } from "drizzle-orm";
import { fromStored, toStored } from "../shared/messages.ts";
import type { Session, SessionSummary, StoredMessage } from "../shared/types.ts";
import { db } from "./db/client.ts";
import { messages, type NewMessageRow, type SessionRow, sessions } from "./db/schema.ts";

/**
 * Sessions and their messages.
 *
 * A turn only ever appends, so this exposes the append rather than a save: `addMessage` writes
 * the one row a step produced, and `patchMessage` fills in the stats and follow-ups that are
 * only known once the turn is over. Nothing here rewrites a transcript.
 */

const summarize = (row: SessionRow): SessionSummary => ({
  id: row.id,
  title: row.title,
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  model: row.model,
  usage: row.usage ?? undefined,
  loadedTools: row.loadedTools,
  compaction: row.compaction ?? undefined,
  messageCount: row.messageCount,
});

export async function createSession(init: { title?: string } = {}): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({ title: init.title ?? "New chat" })
    .returning();
  const { messageCount, ...summary } = summarize(row);
  return { ...summary, messages: [] };
}

export async function getSession(id: string): Promise<Session | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.id, id)).limit(1);
  if (!row) return null;
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.sessionId, id))
    .orderBy(asc(messages.idx));
  const { messageCount, ...summary } = summarize(row);
  return { ...summary, messages: rows.map(toStored) };
}

export async function listSessions(): Promise<SessionSummary[]> {
  const rows = await db.select().from(sessions).orderBy(desc(sessions.updatedAt));
  return rows.map(summarize);
}

export async function deleteSession(id: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, id));
}

/** The session's own columns — never its messages, which are only ever appended. */
export type SessionPatch = Partial<
  Pick<Session, "title" | "model" | "usage" | "loadedTools" | "compaction">
>;

export async function updateSession(id: string, patch: SessionPatch): Promise<void> {
  if (!Object.keys(patch).length) return;
  await db.update(sessions).set(patch).where(eq(sessions.id, id));
}

/**
 * Appends one message and returns its row id, so a later `patchMessage` can reach it.
 *
 * `messageCount` and `updatedAt` move with it: the sidebar reads both off the session row and
 * has no business opening a transcript to draw a list of titles.
 */
export async function addMessage(
  sessionId: string,
  idx: number,
  message: StoredMessage,
): Promise<string> {
  // `fromStored` widens `role` to `string`, which the column's enum will not take; the row
  // itself is exactly the insert shape, so name it as one.
  const values = { sessionId, idx, ...fromStored(message) } as NewMessageRow;
  const [row] = await db.insert(messages).values(values).returning({ id: messages.id });

  await db
    .update(sessions)
    .set({ messageCount: sql`${sessions.messageCount} + 1`, updatedAt: new Date() })
    .where(eq(sessions.id, sessionId));

  return row.id;
}

/** What is only known once the turn has finished: what it cost, and what to ask next. */
export async function patchMessage(
  id: string,
  patch: Pick<StoredMessage, "stats" | "followups">,
): Promise<void> {
  await db.update(messages).set(patch).where(eq(messages.id, id));
}
