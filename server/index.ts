import fs from "node:fs";
import path from "node:path";
import express from "express";
import { api } from "./api.ts";
import { loadMcpServers } from "./config.ts";
import * as cron from "./cron.ts";
import { mcp } from "./mcp.ts";
import { displayHost, HOST, PORT, ROOT } from "./paths.ts";

const app = express();
app.use(express.json({ limit: "2mb" }));

// The Android and Electron builds load their UI from somewhere other than this server,
// so the API has to answer cross-origin. Nothing here is authenticated — min-agent is
// meant to sit on a network you trust — so the origin is simply echoed back.
app.use("/api", (request, response, next) => {
  response.set("Access-Control-Allow-Origin", request.get("Origin") ?? "*");
  response.set("Access-Control-Allow-Headers", "Content-Type");
  response.set("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  if (request.method === "OPTIONS") {
    response.sendStatus(204);
    return;
  }
  next();
});

app.use("/api", api);

// The Expo build, when one has been exported, is served alongside the web app at /app.
const expo = path.join(ROOT, "mobile", "dist");
if (fs.existsSync(expo)) {
  app.use("/app", express.static(expo));
  app.get(/^\/app(\/.*)?$/, (_req, res) => res.sendFile(path.join(expo, "index.html")));
}

// In production the built client is served from the same origin.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use(
  (error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    res.status(500).json({ error: error.message });
  },
);

app.listen(PORT, HOST, () => {
  console.log(`[min-agent] http://${displayHost()}:${PORT}`);
});

await mcp.sync(loadMcpServers());
cron.sync();

const shutdown = async () => {
  await mcp.sync([]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
