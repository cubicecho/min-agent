# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build ----
# Building the web client needs tsc, Vite and Tailwind, none of which the running
# server has any use for. They stay in this stage and only `dist/` crosses over.
FROM node:26-slim AS builder

WORKDIR /app

# Manifests on their own first, so the install layer is cached until a dependency
# actually changes rather than on every source edit.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# -------------------------------------------------------------- runtime ----
# Deliberately the full node image rather than distroless or alpine: MCP servers are
# spawned as child processes, and an stdio server is almost always `npx something`, so
# npm has to exist in here and has to be able to reach the network.
FROM node:26-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server is not compiled — it runs its TypeScript through tsx — so the sources ship
# as they are, next to the client that Vite built.
COPY server ./server
COPY shared ./shared
# The migrations the server applies on boot. Without them a fresh database comes up empty
# and every query fails on a missing table.
COPY drizzle ./drizzle
COPY --from=builder /app/dist ./dist

# The Expo bundle that would be served at /app is left out on purpose: building it means
# installing React Native and Metro to produce a second copy of the UI this image already
# serves at /. Export it on the host and mount `mobile/dist` if you want it here too.

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
# Settings, MCP servers and every session live in Postgres now, so the image itself is
# stateless — there is nothing left to mount. `db` is the service in docker-compose.yml.
ENV DATABASE_URL=postgres://min_agent:min_agent@db:5432/min_agent

EXPOSE 8787

# `health` is a real query, so answering it means the tables exist, the settings row has
# been read and the schema is mounted — which is the thing worth waiting on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch("http://localhost:" + (process.env.PORT || 8787) + "/graphql", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: "{ health { ok } }" }) }).then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

# Run node directly rather than through `npm start`: npm would sit between Docker and the
# server as PID 1 and swallow the SIGTERM that disconnects the MCP servers on the way out.
# `--env-file-if-exists` is kept so a mounted .env still works, as it does on the host.
CMD ["node", "--env-file-if-exists=.env", "--import", "tsx", "server/index.ts"]
