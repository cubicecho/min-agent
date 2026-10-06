import type { QueryClient } from "@tanstack/react-query";

/**
 * The cache key of every query the app makes. Written once, because a key is how a mutation
 * finds the query it has to refresh, and one spelled differently refreshes nothing in silence.
 */
export const queryKeys = {
  config: ["config"],
  models: ["models"],
  embeds: ["embeds"],
  mcp: ["mcp"],
  mcpPrompts: ["mcp-prompts"],
  sessions: ["sessions"],
  /** One chat's transcript. Null while the empty pane has no chat yet. */
  session: (id: string | null) => ["session", id] as const,
} as const;

/**
 * Refetches a chat and the list it is in. Anything that changes a chat changes its row in the
 * list as well: its title, or when it was last touched.
 */
export async function invalidateSession(queryClient: QueryClient, id: string) {
  await queryClient.invalidateQueries({ queryKey: queryKeys.session(id) });
  await queryClient.invalidateQueries({ queryKey: queryKeys.sessions });
}
