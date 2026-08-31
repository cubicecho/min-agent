import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import express from "express";
import { api } from "./api.ts";
import { loadMcpServers } from "./config.ts";
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

/**
 * Gzip for JSON, which is the only large thing this server sends: a session GET is the whole
 * transcript, and a long one is megabytes that a phone across the LAN feels.
 *
 * This wraps `res.json` rather than the socket, which keeps it to what it is for. Streamed
 * turns write their frames with `res.write` and never come through here, so a turn cannot end
 * up buffered waiting to be compressed — the failure mode a general-purpose compressor has to
 * be talked out of. Small bodies are left alone; below about a kilobyte the header costs more
 * than the saving.
 */
app.use("/api", (request, response, next) => {
  const wanted = /\bgzip\b/.test(request.get("Accept-Encoding") ?? "");
  const plain = response.json.bind(response);

  response.json = ((body: unknown) => {
    const text = JSON.stringify(body);
    if (!wanted || Buffer.byteLength(text) < 1024) return plain(body);

    response.set("Content-Type", "application/json; charset=utf-8");
    response.set("Vary", "Accept-Encoding");
    zlib.gzip(text, (error, packed) => {
      if (error) return plain(body);
      response.set("Content-Encoding", "gzip");
      response.set("Content-Length", String(packed.length));
      response.end(packed);
    });
    return response;
  }) as typeof response.json;

  next();
});

app.use("/api", api);

/**
 * Both builders fingerprint what they emit — Vite into `assets/`, Expo into `_expo/static/` —
 * so those files are good forever and a changed one arrives under a different name. Everything
 * else, the HTML shell above all, keeps its name across every build and has to be revalidated
 * or a deploy never reaches the browser.
 */
const fingerprinted = (filePath: string) =>
  filePath.includes(`${path.sep}assets${path.sep}`) ||
  filePath.includes(`${path.sep}_expo${path.sep}static${path.sep}`);

const staticOptions: Parameters<typeof express.static>[1] = {
  setHeaders(response, filePath) {
    response.setHeader(
      "Cache-Control",
      fingerprinted(filePath) ? "public, max-age=31536000, immutable" : "no-cache",
    );
  },
};

const shell = { headers: { "Cache-Control": "no-cache" } };

// The Expo build, when one has been exported, is served alongside the web app at /app.
const expo = path.join(ROOT, "mobile", "dist");
if (fs.existsSync(expo)) {
  app.use("/app", express.static(expo, staticOptions));
  app.get(/^\/app(\/.*)?$/, (_req, res) => res.sendFile(path.join(expo, "index.html"), shell));
}

// In production the built client is served from the same origin.
const dist = path.join(ROOT, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, staticOptions));
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html"), shell));
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

const shutdown = async () => {
  await mcp.sync([]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
