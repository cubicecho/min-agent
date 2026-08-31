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
COPY --from=builder /app/dist ./dist

# The Expo bundle that would be served at /app is left out on purpose: building it means
# installing React Native and Metro to produce a second copy of the UI this image already
# serves at /. Export it on the host and mount `mobile/dist` if you want it here too.

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
# Config and sessions are both seeded on first boot, so pointing them into one volume is
# the whole of what it takes to keep them across a new image.
ENV MIN_AGENT_CONFIG_DIR=/data/config
ENV MIN_AGENT_DATA_DIR=/data

RUN mkdir -p /data
VOLUME /data

EXPOSE 8787

# /api/health reads the LLM config off disk, so it answers only once the seeding and the
# routes are both up — which is the thing worth waiting on.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch("http://localhost:" + (process.env.PORT || 8787) + "/api/health").then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'

# Run node directly rather than through `npm start`: npm would sit between Docker and the
# server as PID 1 and swallow the SIGTERM that disconnects the MCP servers on the way out.
# `--env-file-if-exists` is kept so a mounted .env still works, as it does on the host.
CMD ["node", "--env-file-if-exists=.env", "--import", "tsx", "server/index.ts"]
