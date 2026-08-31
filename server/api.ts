import { Router } from "express";
import { z } from "zod";
import {
  type LlmConfigView,
  llmConfigSchema,
  mcpServerSchema,
  type StreamEvent,
} from "../shared/types.ts";
import { listModels, runTurn } from "./agent.ts";
import {
  loadLlmConfig,
  loadMcpServers,
  resolveApiKey,
  saveLlmConfig,
  saveMcpServers,
} from "./config.ts";
import { mcp } from "./mcp.ts";
import { createSession, deleteSession, getSession, listSessions, saveSession } from "./store.ts";

export const api = Router();

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/* ------------------------------------------------------------------ config */

function view(): LlmConfigView {
  const { apiKey, ...rest } = loadLlmConfig();
  return { ...rest, hasApiKey: Boolean(apiKey || process.env.OPENAI_API_KEY) };
}

api.get("/config", (_req, res) => res.json(view()));

/** An empty `apiKey` keeps whatever is already in llm.yaml. */
api.put("/config", (req, res) => {
  const parsed = llmConfigSchema.partial({ apiKey: true }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });

  const current = loadLlmConfig();
  saveLlmConfig({ ...parsed.data, apiKey: parsed.data.apiKey || current.apiKey });
  res.json(view());
});

api.get("/models", async (_req, res) => {
  try {
    res.json({ models: await listModels() });
  } catch (error) {
    res.status(502).json({ error: message(error) });
  }
});

/* ---------------------------------------------------------------- sessions */

api.get("/sessions", (_req, res) => res.json(listSessions()));

api.post("/sessions", (_req, res) => res.status(201).json(createSession()));

api.get("/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  return session ? res.json(session) : res.status(404).json({ error: "session not found" });
});

api.patch("/sessions/:id", (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });

  const title = z.string().min(1).max(200).safeParse(req.body?.title);
  if (!title.success) return res.status(400).json({ error: "title is required" });

  session.title = title.data;
  saveSession(session);
  res.json(session);
});

api.delete("/sessions/:id", (req, res) => {
  deleteSession(req.params.id);
  res.status(204).end();
});

/** Streams one turn back as server-sent events. */
api.post("/sessions/:id/messages", async (req, res) => {
  const session = getSession(req.params.id);
  if (!session) return res.status(404).json({ error: "session not found" });

  const body = z
    .object({ prompt: z.string().min(1), model: z.string().optional() })
    .safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "prompt is required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: StreamEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const controller = new AbortController();
  // Watch `res`, not `req`: since Node 16 an IncomingMessage emits "close" as soon as its body
  // has been read, which would abort the turn before the model ever replies.
  res.on("close", () => controller.abort());

  try {
    await runTurn({
      session,
      prompt: body.data.prompt,
      model: body.data.model,
      onEvent: send,
      signal: controller.signal,
    });
    send({ type: "done" });
  } catch (error) {
    if (!controller.signal.aborted) send({ type: "error", message: message(error) });
  } finally {
    res.end();
  }
});

/* -------------------------------------------------------------------- mcp */

api.get("/mcp", (_req, res) => res.json(mcp.state()));

api.put("/mcp", async (req, res) => {
  const parsed = z.array(mcpServerSchema).safeParse(req.body?.servers);
  if (!parsed.success) return res.status(400).json({ error: z.prettifyError(parsed.error) });
  if (new Set(parsed.data.map((server) => server.id)).size !== parsed.data.length) {
    return res.status(400).json({ error: "duplicate server id" });
  }

  saveMcpServers(parsed.data);
  await mcp.sync(parsed.data);
  res.json(mcp.state());
});

api.post("/mcp/:id/reconnect", async (req, res) => {
  await mcp.reconnect(req.params.id, loadMcpServers());
  res.json(mcp.state());
});

/* ----------------------------------------------------------------- health */

api.get("/health", (_req, res) => {
  const config = loadLlmConfig();
  res.json({
    ok: true,
    baseUrl: config.baseUrl,
    model: config.model,
    hasApiKey: Boolean(resolveApiKey(config)),
  });
});
