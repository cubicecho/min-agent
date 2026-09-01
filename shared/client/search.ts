/**
 * The one matching rule in the app, so that typing into any box here behaves the same way.
 *
 * Every whitespace-separated term has to appear, in any order, so typing more always narrows —
 * "docker ci" finds "CI for the Docker image" without anyone having to remember the wording.
 * Matching is done on the client in every case: the list being filtered is already in memory,
 * and a round trip per keystroke would be slower than the scanning it replaced.
 */
export function matchTerms<T>(items: T[], query: string, text: (item: T) => string): T[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items;
  return items.filter((item) => {
    const haystack = text(item).toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
