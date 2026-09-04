# syntax=docker/dockerfile:1

# ---------------------------------------------------------------- build ----
# Building the UI needs React Native, Metro and Tailwind, none of which the running
# server has any use for. They stay in this stage and only `mobile/dist` crosses over.
FROM node:26-slim AS builder

WORKDIR /app

# Manifests on their own first, so the install layers are cached until a dependency
# actually changes rather than on every source edit. The Expo app has its own lockfile
# and its own node_modules — Metro pins resolution to `mobile/node_modules` — so it is
# a second install rather than a workspace.
COPY package.json package-lock.json ./
RUN npm ci
COPY mobile/package.json mobile/package-lock.json ./mobile/
RUN npm ci --prefix mobile

COPY . .

# Regenerates the GraphQL types, typechecks, then exports the web bundle to `mobile/dist`.
# The address the app talks to is not baked in here: served from this image it is the origin
# that served the page, which is right whatever host it is reached at.
RUN npm run build

# -------------------------------------------------------------- runtime ----
# Deliberately the full node image rather than distroless or alpine: MCP servers are
# spawned as child processes, and an stdio server is almost always `npx something`, so
# npm has to exist in here and has to be able to reach the network.
FROM node:26-slim

WORKDIR /app

# Dictation against a Wyoming server needs the recording decoded to PCM first, and this is
# what decodes it — see `server/audio.ts`. It is the one apt package in the image and it is
# not a small one; drop this line if nobody here points **Speech to text** at a `tcp://`
# address, and the route says so in its error rather than failing quietly.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# The server is not compiled — it runs its TypeScript through tsx — so the sources ship
# as they are, next to the UI that Metro built.
COPY server ./server
COPY shared ./shared
# The migrations the server applies on boot. Without them a fresh database comes up empty
# and every query fails on a missing table.
COPY drizzle ./drizzle
COPY --from=builder /app/mobile/dist ./mobile/dist

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
