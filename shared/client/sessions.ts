import { matchTerms } from "./search.ts";

/** Below this many chats the box is just something in the way, so the list hides it. */
export const SEARCH_AFTER = 8;

/** Filters the session list by title, on the rule in `matchTerms`. */
export const matchSessions = <T extends { title: string }>(sessions: T[], query: string): T[] =>
  matchTerms(sessions, query, (session) => session.title);

/* ------------------------------------------------------------------ grouping */

export type Bucket = "today" | "yesterday" | "week" | "earlier";

export const BUCKET_LABEL: Record<Bucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  earlier: "Earlier",
};

/** Fixed, so a group never moves about between renders as chats come and go. */
const ORDER: Bucket[] = ["today", "yesterday", "week", "earlier"];

const DAY = 86_400_000;

const startOfDay = (at: number) => {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
};

/**
 * Which heading a chat belongs under, by calendar day rather than by elapsed hours: at nine
 * in the morning, something from eleven last night is yesterday, not "14 hours ago".
 *
 * The difference is rounded because the two midnights it measures between can be 23 or 25
 * hours apart when the clocks change, and a chat should not slide into the wrong day for it.
 * A timestamp in the future is today — that is a clock out of step, not a bucket to invent.
 */
export function bucketOf(iso: string, now: number = Date.now()): Bucket {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(iso).getTime())) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "earlier";
}

export type SessionGroup<T> = { bucket: Bucket; label: string; sessions: T[] };

/**
 * The list under Today / Yesterday / This week / Earlier headings.
 *
 * Order within a group is the order it was handed, which is the server's `updatedAt`
 * descending; an empty group is dropped rather than shown as a heading over nothing.
 */
export function groupSessions<T extends { updatedAt: string }>(
  sessions: T[],
  now: number = Date.now(),
): SessionGroup<T>[] {
  const held = new Map<Bucket, T[]>();
  for (const session of sessions) {
    const bucket = bucketOf(session.updatedAt, now);
    const group = held.get(bucket);
    if (group) group.push(session);
    else held.set(bucket, [session]);
  }
  return ORDER.filter((bucket) => held.has(bucket)).map((bucket) => ({
    bucket,
    label: BUCKET_LABEL[bucket],
    sessions: held.get(bucket) as T[],
  }));
}
