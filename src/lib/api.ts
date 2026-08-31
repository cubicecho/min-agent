import type {
  CronJob,
  CronJobState,
  CronRun,
  LlmConfig,
  LlmConfigView,
  McpServerConfig,
  McpServerState,
  ModelInfo,
  Session,
  SessionSummary,
  StreamEvent,
} from "@shared/types.ts";

type Options = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, init?: Options): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  if (!response.ok) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${response.status} ${response.statusText}`);
  }
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const api = {
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

  crons: () => request<CronJobState[]>("/crons"),
  saveCrons: (jobs: CronJob[]) =>
    request<CronJobState[]>("/crons", { method: "PUT", body: { jobs } }),
  cronRuns: (id: string) => request<CronRun[]>(`/crons/${id}/runs`),
  runCron: (id: string) =>
    request<{ sessionId: string; state: CronJobState[] }>(`/crons/${id}/run`, { method: "POST" }),
};

export interface TurnOptions {
  sessionId: string;
  prompt: string;
  model?: string;
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

/** POSTs a turn and hands the server's SSE events to `onEvent` as they arrive. */
export async function streamTurn({ sessionId, prompt, model, onEvent, signal }: TurnOptions) {
  const response = await fetch(`/api/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, model }),
    signal,
  });

  if (!response.ok || !response.body) {
    const detail = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(detail?.error ?? `${response.status} ${response.statusText}`);
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;

    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const data = frame.replace(/^data: /, "").trim();
      if (data) onEvent(JSON.parse(data) as StreamEvent);
    }
  }
}
