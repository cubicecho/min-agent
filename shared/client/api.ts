import type {
  LlmConfig,
  LlmConfigView,
  McpServerConfig,
  McpServerState,
  ModelInfo,
  Session,
  SessionSummary,
  StreamEvent,
} from "../types.ts";

type Options = Omit<RequestInit, "body"> & { body?: unknown };

/**
 * `fetch` is injected because React Native's built-in one cannot stream: Expo apps
 * pass `fetch` from `expo/fetch`, which returns a real `ReadableStream` body.
 */
export interface ClientOptions {
  /**
   * Prefixed to every path — `"/api"` in the browser, an absolute
   * `"http://host:8787/api"` on a device. A function is re-read on every call, so a
   * client built once still follows a server address the user edits later.
   */
  baseUrl: string | (() => string);
  fetch?: typeof globalThis.fetch;
}

export interface TurnOptions {
  sessionId: string;
  prompt: string;
  model?: string;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export type ApiClient = ReturnType<typeof createClient>["api"];

/** Reads an error body that may not be JSON — a wrong server address returns HTML. */
async function failure(response: Response): Promise<Error> {
  const detail = (await response.json().catch(() => null)) as { error?: string } | null;
  return new Error(detail?.error ?? `${response.status} ${response.statusText}`);
}

/**
 * A 200 that will not parse is almost always a dev server answering an unknown path with
 * its `index.html`, and `Unexpected token '<'` says nothing about why. Name the address.
 */
const wrongServer = (requested: string) =>
  new Error(`${requested} answered with HTML, not JSON — is that the min-agent server?`);

export function createClient({ baseUrl, fetch: fetchImpl }: ClientOptions) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = (path: string) => `${typeof baseUrl === "function" ? baseUrl() : baseUrl}${path}`;

  async function request<T>(path: string, init?: Options): Promise<T> {
    const response = await doFetch(url(path), {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
    if (!response.ok) throw await failure(response);
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      throw wrongServer(url(path));
    }
  }

  const api = {
    config: () => request<LlmConfigView>("/config"),
    saveConfig: (config: Partial<LlmConfig>) =>
      request<LlmConfigView>("/config", { method: "PUT", body: config }),
    models: () => request<{ models: ModelInfo[] }>("/models"),

    sessions: () => request<SessionSummary[]>("/sessions"),
    session: (id: string) => request<Session>(`/sessions/${id}`),
    createSession: () => request<Session>("/sessions", { method: "POST" }),
    renameSession: (id: string, title: string) =>
      request<Session>(`/sessions/${id}`, { method: "PATCH", body: { title } }),
    deleteSession: (id: string) => request<void>(`/sessions/${id}`, { method: "DELETE" }),

    mcp: () => request<McpServerState[]>("/mcp"),
    saveMcp: (servers: McpServerConfig[]) =>
      request<McpServerState[]>("/mcp", { method: "PUT", body: { servers } }),
    reconnectMcp: (id: string) =>
      request<McpServerState[]>(`/mcp/${id}/reconnect`, { method: "POST" }),
  };

  /** POSTs a turn and hands the server's SSE events to `onEvent` as they arrive. */
  async function streamTurn({ sessionId, prompt, model, onEvent, signal }: TurnOptions) {
    const response = await doFetch(url(`/sessions/${sessionId}/messages`), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ prompt, model }),
      signal,
    });

    if (!response.ok || !response.body) throw await failure(response);

    // Decoding by hand rather than via `TextDecoderStream`, which React Native lacks.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const data = frame.replace(/^data: /, "").trim();
        if (data) onEvent(JSON.parse(data) as StreamEvent);
      }
    }
  }

  return { api, streamTurn };
}
