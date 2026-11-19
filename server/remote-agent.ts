import { type Endpoint, NO_KEY, normalizeBaseUrl } from "@cubicecho/agent-core";

/**
 * Whether a model is a remote agent: one that runs a whole agent loop of its own behind the chat
 * completions API, as ai-router serves one per agent name, and hands the app's own tools back to
 * it. A turn on one runs agent-core's loop as a thin client (`remoteAgent: true`), since the
 * tools a loop keeps for itself (`load_tools`, `call_tool`) are names such a server refuses to
 * take as the app's, and its compaction, pruning and tool loading are the server's to do.
 *
 * ai-router says so on its model listing, `"ai_router": { "kind": "agent" }` on the entry, and
 * agent-core's `listModels` keeps only an entry's id and window, so the listing is read here.
 */

/** What an ai-router model entry carries to say it is an agent. */
const AGENT_KIND = "agent";

/**
 * What is known, per model server and model. A model does not stop being an agent while the
 * process runs, so an answer is kept; a listing that could not be read is not an answer, and is
 * asked again on the next turn.
 */
const known = new Map<string, boolean>();

/** Forgets what is known, so one test's endpoint is not the next one's. */
export const resetRemoteAgents = () => known.clear();

/**
 * Whether `model` on `server` is a remote agent.
 *
 * @param server The model server, as the turn reaches it.
 * @param model The model the turn runs on.
 * @returns `true` where the listing marks the model an agent; `false` where it does not, or where
 * there is no listing to read.
 */
export async function isRemoteAgent(server: Endpoint, model: string): Promise<boolean> {
  const baseUrl = normalizeBaseUrl(server.baseUrl) ?? server.baseUrl.replace(/\/+$/, "");
  const key = `${baseUrl}\u0000${model}`;
  const kept = known.get(key);
  if (kept !== undefined) {
    return kept;
  }
  const listed = await listing(server, baseUrl);
  if (listed === undefined) {
    return false;
  }
  const entry = listed.find((each) => each.id === model);
  const isAgent = entry?.ai_router?.kind === AGENT_KIND;
  known.set(key, isAgent);
  return isAgent;
}

interface ListedModel {
  id?: unknown;
  ai_router?: { kind?: unknown };
}

/**
 * The server's `/models` entries, or `undefined` where they could not be read.
 *
 * @param server The model server, for its key and its `fetch`.
 * @param baseUrl Its base URL, normalised.
 */
async function listing(server: Endpoint, baseUrl: string): Promise<ListedModel[] | undefined> {
  const send = server.fetch ?? fetch;
  const headers: Record<string, string> =
    server.apiKey && server.apiKey !== NO_KEY ? { Authorization: `Bearer ${server.apiKey}` } : {};
  try {
    const response = await send(`${baseUrl}/models`, { headers });
    if (!response.ok) {
      return undefined;
    }
    const body = (await response.json()) as { data?: unknown };
    return Array.isArray(body.data) ? (body.data as ListedModel[]) : undefined;
  } catch {
    return undefined;
  }
}
