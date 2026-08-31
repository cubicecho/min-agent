import fs from "node:fs";
import path from "node:path";
import express from "express";
import { api } from "./api.ts";
import { loadMcpServers } from "./config.ts";
import * as cron from "./cron.ts";
import { mcp } from "./mcp.ts";
import { PORT, ROOT } from "./paths.ts";

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use("/api", api);

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

app.listen(PORT, () => {
  console.log(`[min-agent] http://localhost:${PORT}`);
});

await mcp.sync(loadMcpServers());
cron.sync();

const shutdown = async () => {
  await mcp.sync([]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
