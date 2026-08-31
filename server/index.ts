import fs from "node:fs";
import path from "node:path";
import compression from "compression";
import express from "express";
import { createYoga } from "graphql-yoga";
import { loadMcpServers, refreshLlmConfig } from "./config.ts";
import { waitForDatabase } from "./db/client.ts";
import { runMigrations } from "./db/migrate.ts";
import { schema } from "./graphql/schema.ts";
import { mcp } from "./mcp.ts";
import { displayHost, HOST, PORT, ROOT } from "./paths.ts";

// The tables and the settings row have to exist before anything reads them, and the settings
// cache has to be warm before the first turn asks it for a model. The database may still be
// coming up — see `waitForDatabase` — so this is the one place that tolerates it being late.
await waitForDatabase();
await runMigrations();
await refreshLlmConfig();

const app = express();

const yoga = createYoga({
  schema,
  graphqlEndpoint: "/graphql",
  // The Android and Electron builds load their UI from somewhere other than this server, so
  // the API has to answer cross-origin. Nothing here is authenticated — min-agent is meant to
  // sit on a network you trust — so the origin is simply echoed back.
  cors: (request) => ({
    origin: request.headers.get("origin") ?? "*",
    credentials: true,
    allowedHeaders: ["Content-Type"],
    methods: ["GET", "POST", "OPTIONS"],
  }),
  // Landing on the endpoint in a browser should explain itself; GraphiQL is how a schema
  // this size is read.
  graphiql: { title: "min-agent" },
});

/**
 * Gzip for GraphQL responses, which are the only large thing this server sends: reading a
 * session is the whole transcript, and a long one is megabytes that a phone across the LAN
 * feels.
 *
 * The filter is the point. A streamed turn is `text/event-stream`, and buffering one to
 * compress it would deliver the whole answer at the end — the opposite of what streaming it
 * was for. Everything else here is JSON, and compresses well.
 */
app.use(
  "/graphql",
  compression({
    filter: (_request, response) =>
      !String(response.getHeader("Content-Type") ?? "").includes("text/event-stream"),
  }),
);

app.use(yoga.graphqlEndpoint, yoga);

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
  app.get(/^(?!\/graphql).*/, (_req, res) => res.sendFile(path.join(dist, "index.html"), shell));
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

await mcp.sync(await loadMcpServers());

const shutdown = async () => {
  await mcp.sync([]);
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
