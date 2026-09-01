import { matchTerms } from "./search.ts";

/** Below this many chats the box is just something in the way, so the list hides it. */
export const SEARCH_AFTER = 8;

/** Filters the session list by title, on the rule in `matchTerms`. */
export const matchSessions = <T extends { title: string }>(sessions: T[], query: string): T[] =>
  matchTerms(sessions, query, (session) => session.title);
