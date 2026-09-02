import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { usageOf } from "../shared/client/transcript.ts";
import { fromStored, toStored } from "../shared/messages.ts";
import type { Session, SessionSummary, StoredMessage } from "../shared/types.ts";
import { db } from "./db/client.ts";
import { messages, type NewMessageRow, type SessionRow, sessions } from "./db/schema.ts";

/**
 * Sessions and their messages.
 *
 * A turn only ever appends, so this exposes the append rather than a save: `addMessage` writes
 * the one row a step produced, and `patchMessage` fills in the stats and follow-ups that are
 * only known once the turn is over. Nothing here edits a message.
 *
 * `truncateSession` is the one thing that removes any, and it removes a suffix: retrying a
 * reply and editing a question both mean "forget from here", and what follows the cut is
 * an answer to something that is no longer being asked.
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
 * has no business opening a transcript to draw a list of titles. The two writes are one
 * transaction because the count is not derived from anything — nothing recomputes it, and
 * `truncateSession` is the only other thing that sets it — so a row that landed without its
 * increment would leave the sidebar under-counting that conversation for good.
 */
export async function addMessage(
  sessionId: string,
  idx: number,
  message: StoredMessage,
): Promise<string> {
  // `fromStored` widens `role` to `string`, which the column's enum will not take; the row
  // itself is exactly the insert shape, so name it as one.
  const values = { sessionId, idx, ...fromStored(message) } as NewMessageRow;

  return await db.transaction(async (tx) => {
    const [row] = await tx.insert(messages).values(values).returning({ id: messages.id });

    await tx
      .update(sessions)
      .set({ messageCount: sql`${sessions.messageCount} + 1`, updatedAt: new Date() })
      .where(eq(sessions.id, sessionId));

    return row.id;
  });
}

/** What is only known once the turn has finished: what it cost, and what to ask next. */
export async function patchMessage(
  id: string,
  patch: Pick<StoredMessage, "stats" | "followups">,
): Promise<void> {
  await db.update(messages).set(patch).where(eq(messages.id, id));
}

/**
 * Drops every message from `fromIdx` on, and puts the session's own columns back in step.
 *
 * The counters are derived rather than adjusted: `messageCount` is where the transcript now
 * ends, and the banked usage is what the turns that are left still add up to — a decrement
 * would have to trust that the rows and the totals never drifted, and this does not have to.
 * A compaction is dropped if it summarised anything past the cut: it is a description of
 * messages that no longer exist, and the next turn would send it as if they did.
 *
 * `idx` stays dense because only a suffix ever goes, which is what lets the client keep
 * treating a message's position in the array as its index.
 */
export async function truncateSession(id: string, fromIdx: number): Promise<number> {
  const session = await getSession(id);
  if (!session) throw new Error("session not found");

  const from = Math.max(0, Math.floor(fromIdx));
  if (from >= session.messages.length) return session.messages.length;

  await db.delete(messages).where(and(eq(messages.sessionId, id), gte(messages.idx, from)));

  const kept = session.messages.slice(0, from);
  await db
    .update(sessions)
    .set({
      messageCount: from,
      updatedAt: new Date(),
      usage: usageOf(kept),
      compaction:
        session.compaction && session.compaction.through <= from ? session.compaction : null,
    })
    .where(eq(sessions.id, id));

  return from;
}
