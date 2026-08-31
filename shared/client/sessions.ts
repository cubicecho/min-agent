/** Below this many chats the box is just something in the way, so the list hides it. */
export const SEARCH_AFTER = 8;

/**
 * Filters the session list by title.
 *
 * Every whitespace-separated term has to appear, in any order, so typing more always narrows —
 * "docker ci" finds "CI for the Docker image" without anyone having to remember the wording.
 * Matching is done here rather than on the server: the list is already in memory, and a round
 * trip per keystroke would be slower than the search it replaced.
 */
export function matchSessions<T extends { title: string }>(sessions: T[], query: string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return sessions;
  return sessions.filter((session) => {
    const title = session.title.toLowerCase();
    return terms.every((term) => title.includes(term));
  });
}
