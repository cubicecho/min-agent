# min-agent

A very small self-hosted agent: chat sessions over any OpenAI-compatible server, with MCP tools.
Replies render as markdown with syntax-highlighted code, and every turn reports what it cost in
tokens, time and throughput. Everything it knows — settings, MCP servers, sessions and every
message — lives in Postgres, reached over a GraphQL API generated from the schema.

## Contents

Everything below the quick start is reference — read it when you want that piece, not in order.

- [Quick start](#quick-start) · [Production](#production) · [Docker](#docker) — running it
- [Layout](#layout) · [The database](#the-database) · [The API](#the-api) · [Scripts](#scripts) — finding your way around
- [MCP servers](#mcp-servers) — wiring up tools, and how they are loaded without blowing the prompt budget
- [Task models](#task-models) — pointing a small fast model at titling, compaction, tool preselection and follow-ups
- [Turn statistics](#turn-statistics) — what the numbers under each reply mean
- [Keyboard shortcuts](#keyboard-shortcuts) — what the desktop and browser builds bind
- [The session list](#the-session-list) — grouping, renaming, deleting and finding a chat
- [Other apps in the sidebar](#other-apps-in-the-sidebar) — framing a kanban board or a task server beside the chat
- [Android and Windows](#android-and-windows) — the same front end, off the browser

## Stack

Expo (React Native) + expo-router + NativeWind on the front, Express 5 and graphql-yoga on the
back, Drizzle over Postgres underneath. TypeScript everywhere, Biome for lint/format, Vitest for
tests.

There is one front end, in `mobile/`, and it builds three things: the browser UI the server
serves at `/` (through react-native-web), an Android app, and a Windows or Linux desktop app
through Electron. See [Android and Windows](#android-and-windows).

## Quick start

```bash
npm install
npm install --prefix mobile   # the app has its own lockfile — see below
cp .env.example .env          # DATABASE_URL lives here
docker compose up -d db       # or point DATABASE_URL at a Postgres you already run
npm run dev                   # api on :8787, app on :8081
```

The server applies its migrations at boot and seeds the settings row, so an empty database is
the right starting point and there is nothing to run by hand. `npm run db:studio` opens Drizzle
Studio against the same URL if you want to look inside.

Open http://localhost:8081, go to **Settings → Agent**, point it at an OpenAI-compatible server, hit
**Refresh** to list models, pick one, **Save**.

Known-good base URLs:

| Server    | Base URL                       | API key            |
| --------- | ------------------------------ | ------------------ |
| Ollama    | `http://localhost:11434/v1`    | not needed         |
| LM Studio | `http://localhost:1234/v1`     | not needed         |
| OpenAI    | `https://api.openai.com/v1`    | `sk-…`             |
| OpenRouter| `https://openrouter.ai/api/v1` | `sk-or-…`          |

The key can also come from `OPENAI_API_KEY` in the environment (see `.env.example`); the value
saved under **Settings → Agent** wins if both are set.

### Where it listens

Copy `.env.example` to `.env` to change it. Both `npm run dev` and `npm start` read that file —
Node loads it directly, through `--env-file-if-exists`, so there is no dotenv dependency and no
import to remember — and `scripts/expo.ts` reads the same file to bake the address into the
bundle, so the app follows the server rather than going on knocking at 8787.

`DATABASE_URL` is the Postgres the server stores everything in; it refuses to start without one
it can reach. `PORT` is the Express port. `HOST` is the interface it binds; the default, `0.0.0.0`, accepts
connections from the LAN, which is what the Android and desktop apps need to reach it at all.
Setting it to `localhost` takes that back and accepts local connections only — worth doing on a
network you do not trust, since nothing here is authenticated. The startup line prints an address
you can actually open, so a wildcard bind shows as `localhost`.

## Production

```bash
npm run build    # codegen + typecheck + expo export -> mobile/dist
npm start        # express serves the API and mobile/dist on :8787
```

## Docker

```bash
docker compose up -d          # http://localhost:8787
```

The image is the server and the web build of the app, nothing else. It stays a full `node`
image rather than something smaller because MCP stdio servers are spawned as child processes
and an stdio server is usually `npx something`, which needs npm and a network from inside the
container.

`docker compose up` brings the database with it. Everything — settings, MCP servers, sessions,
messages — is in the `min-agent-db` volume, which is what to keep and what to back up; `pg_dump`
is the way to take a copy. The database port is deliberately not published: only the app
container needs it. The volume is mounted at `/var/lib/postgresql`, not the `/data` subdirectory
under it, because that is where postgres:18 wants it.

An LLM server running on the host machine is `http://host.docker.internal:11434/v1` from in
here, not `localhost`; the compose file maps that name on Linux, where Docker does not provide
it. Nothing in min-agent is authenticated, so publish the port on a network you trust — or bind
it to `127.0.0.1:8787:8787` and put something with a login in front.

The UI is built inside the image, by a first stage that has React Native, Metro and Tailwind in
it; only `mobile/dist` crosses into the runtime stage, so none of that ships. That is a slower
build in exchange for an image anyone can run without having Expo installed anywhere — which is
the point of shipping an image at all. The two installs are separate `npm ci` layers, because
the app has its own lockfile and its own `node_modules`: Metro pins resolution to
`mobile/node_modules`, so it is a second install rather than a workspace.

## Releases

`.github/workflows/ci.yml` lints, tests and builds on every push and pull request, typechecks
the Expo app in a job of its own, and builds the image and boots it against a throwaway Postgres
far enough to answer the `health` query — so a broken Dockerfile, or a schema that no longer
applies to an empty database, is caught before there is a version number riding on it. The test
job gets a Postgres service too, since the store tests skip themselves without one.

`.github/workflows/release.yml` runs after a green CI on `main`. semantic-release reads the
commit messages, and if they amount to a release it tags one and pushes the image to both
`ghcr.io/cubicecho/min-agent` and, optionally, Docker Hub. GHCR needs no setup — the workflow's
own `GITHUB_TOKEN` can push to it. Docker Hub is published to only when `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` are in the repository secrets; without them those steps are skipped and the
release still goes out to GHCR. A run of chores publishes nothing.

## Layout

- `mobile/` — the front end. `app/` is one file per route, `components/ui.tsx` is the widget set,
  `components/settings/` the panels behind the settings tabs, `electron/` is the desktop shell.
  Its web export is what the server serves.
- `server/` — express + graphql-yoga. `agent.ts` is the tool-calling loop, `mcp.ts` the MCP
  client pool, `store.ts` session persistence, `config.ts` the settings and MCP rows.
- `server/db/` — `schema.ts` is the Drizzle table definitions, `client.ts` the pool and the
  boot-time wait for it, `migrate.ts` the migration runner.
- `drizzle/` — generated migrations. Not written by hand; not edited after they have shipped.
- `scripts/` — `codegen-watch.ts` keeps `schema.graphql` and `shared/gql/` current, `expo.ts`
  hands the app the server's address, `print-schema.ts` writes the SDL.
- `server/graphql/` — `schema.ts` builds most of the API off the Drizzle schema and adds the
  hand-written fields (`health`, `models`, `mcpStatus`, `setApiKey`, the `turn` subscription).
- `shared/types.ts` — the domain types, plus the zod schemas the server range-checks a write
  with on the way into the database. The client imports the types; the validators do not leave
  the server.
- `shared/model-tasks.ts` — the `MODEL_TASKS` table the **Agent** settings panel renders. Its own module
  precisely so that reading one constant does not pull zod into the app.
- `shared/messages.ts` — the single translation between a stored row and a chat-completions
  message, so the server and the client spell it the same way.
- `shared/graphql/` — the `.graphql` documents the app sends. `shared/gql/graphql.ts` is
  generated from them and is not edited by hand.
- `shared/highlight.ts` — the lowlight registry and the tokeniser behind a code fence, kept out
  of `mobile/` so it is testable without a React Native runtime.
- `shared/client/` — everything the app runs that is not a view: `gql.ts` (the transport — a
  query is a string and a `fetch`, with no client library), `api.ts` (the typed client and the SSE
  reader), `live.ts` (streaming-event reducer), `use-live-parts.ts` (frame-batched streaming
  state), `sessions.ts` (the session-list filter), `queries.ts` (how long settings stay fresh),
  `usage.ts` (token/cost formatting).
- `tests/` — Vitest (`npm test`).

## The database

Five tables, created by the migrations in `drizzle/`, which `runMigrations()` applies on boot:

```
settings      one row, id 'default' — Settings → Agent
mcp_servers   one row per server, ordered by position — Settings → MCP
embeds        one row per app in the sidebar, ordered by position — Settings → Apps
sessions      one per chat: title, dates, token totals, compaction state
messages      one per message, ordered by (session_id, idx), cascade-deleted with the session
```

Messages are rows rather than a blob on the session, so a turn appends the two or three messages
it produced instead of rewriting the whole transcript seven times. The counters on the session
row — `messageCount`, the token totals — are what the sidebar reads, so listing sessions never
touches the messages table.

`server/db/schema.ts` is the single definition, and the SQL is generated from it — change the
schema, run `npm run db:generate`, and commit the migration it writes alongside the change.
Drizzle records what it has applied, so booting an up-to-date database does nothing and booting
an old one catches it up. `npm run db:migrate` applies them without starting the server.

Migrations run at boot rather than as a separate deploy step, which is a deliberate trade for a
single-instance self-hosted app: `docker compose up` on a new machine is the whole install. The
server waits for the database on the way up rather than crashing on a refused connection —
compose gates on the healthcheck, but a bare `npm start` or a host reboot does not, and
Postgres takes a few seconds to start accepting connections.

## The API

One endpoint, `POST /graphql`, plus GraphiQL at the same address in a browser. Most of it is
generated from the Drizzle schema by `@vantreeseba/drizzle-graphql` — the CRUD over sessions,
messages, settings and MCP servers is not hand-written. On top of that sit the fields that are
not tables:

```
query    health          is the server up, and what is it pointed at
query    models          asks the configured provider to list its models
query    hasApiKey       whether a key is set, without returning it
query    mcpStatus       each configured server with its live connection state and tools
mutation setApiKey       write-only, so the key never comes back out over the API
mutation saveMcpServers  replaces the whole set and reconnects
mutation reconnectMcpServer
subscription turn        runs a turn and streams its events over SSE
```

`schema.graphql` and `shared/gql/graphql.ts` are both committed and neither is written by hand.
Keeping them current is not left to whoever remembers: `scripts/codegen-watch.ts` runs alongside
`npm run dev`, regenerating on start and again whenever `server/` or `shared/graphql/` changes,
and `npm run build` regenerates before it typechecks. CI then fails on a diff, so a schema
change committed without its generated types does not merge, and `npm run codegen` does it on
demand. The schema is printed from the server first, so what the app is typed against is
exactly what it serves.

The generated documents are plain strings, not `graphql` AST objects, which is what keeps the
`graphql` package out of the bundle: Metro pins `nodeModulesPaths` to `mobile/node_modules`, and
it is not installed there.

The `models` query is not a local read — it asks the configured provider to list its models — so
the app holds it, and the connection settings beside it, for five minutes. Saving config
invalidates them by hand, so the only thing this hides is the settings row edited underneath
a running server, which a reload settles.

## MCP servers

Both transports are supported. A stdio server is a command and its arguments —
`npx -y @modelcontextprotocol/server-filesystem /tmp` — and an http one is a URL. Add them under
**Settings → MCP**; each row is a row in `mcp_servers`, and saving reconnects the pool.

Tools are exposed to the model as `<server id>__<tool name>`, so ids must be unique and short.

The panel is a list, and editing happens in a dialog over it — the same shape as
[Apps](#other-apps-in-the-sidebar), for the same reason. What you come here to read is which
servers answered and what they are offering; a row says that in one line (where it points, its
status, how many tools), and a broken one gives its second line over to the error instead of
repeating an address you already typed. The eight fields behind it are for the once you write
them.

There is no Save button. The mutation replaces the whole set, so the dialog is the unit of
work: closing it has already saved, or has told you why it could not. The switch on a row is
the exception that saves in place, because turning a server off is the one edit worth making
without opening anything. A server that falls over while you are on another tab puts a dot on
the MCP tab — the settings shell polls `mcpStatus` slowly on its own for that, which is all the
dot costs.

### On-demand tool loading

A tool definition is mostly JSON Schema, and eagerly sending every one of them on every request is
usually the largest thing in the prompt — 34 tools cost about 11.5k tokens per request here, paid
whether or not the model touches a single one.

**Settings → Agent → MCP tools** picks how they are sent:

- **On demand** (default) puts a *name-only* catalogue in the system prompt — a fortieth of the
  cost of the schemas — plus one meta-tool, `load_tools`. The model calls it with the names it
  wants (or a wildcard like `router__fs__*`), gets their descriptions back, and the real
  definitions join the request from the next round trip of that same turn onward.
- **Eager** sends everything every time. Simpler, and right when there are only a few tools.

Measured on the same server, same prompt:

| | prompt tokens, first round trip |
| --- | --- |
| Eager, 34 tools | 11,568 |
| On demand | 890 |

The trade is one extra round trip on turns that do use a tool — the model spends a step loading
before it can call. Turns that need no tools, which is most chat, pay nothing and save everything.

Four things keep it robust, and the last three exist because leaving them out made the model loop.

A model that skips `load_tools` and calls a catalogued tool directly by name gets it loaded and
executed anyway, rather than an "unknown tool" error.

Names resolve leniently. Catalogue entries are server-qualified (`router__nas_fs__read_file`) and
models routinely ask for the bare `nas_fs__read_file`; an exact miss falls back to a suffix match,
accepted when unambiguous. Rejecting those only buys a wasted round trip while the model guesses
the prefix — and teaches it to shotgun wildcards instead.

One call may load at most `MAX_PER_LOAD` (12) tools. A wildcard like `router__gmail__*` matches 33,
and granting that puts the model back in front of a tool array too large to choose from — the exact
situation on-demand loading exists to avoid. Over-broad requests come back with the matching names
listed, so the next call can be precise.

Only tools the model actually *called* carry over to the next turn, capped at `MAX_CARRIED` (16),
least-recently-used dropped first. Everything else it pulled in was a guess. Carrying the guesses
compounds: a session that loaded a whole Gmail server on turn two started turn three with 35 tools,
wandered into an unrelated one, and burned 167k prompt tokens over 13 iterations on a question that
needed one call.

Within a turn, an identical `(tool, arguments)` pair is answered from the first result instead of
being re-executed, with a note saying so. Models otherwise re-call a tool that disappointed them —
six identical calls in a row, in one observed case.

### Schema compatibility

llama.cpp-backed servers (llama-server, Lemonade, Ollama) compile every tool's parameter schema
into a single GBNF grammar. One shape the converter dislikes fails the whole request, not just the
one tool, and the error is unhelpful — `Unable to generate parser for this template`, or
`Unrecognized schema: "object"`. MCP servers emit those shapes routinely, so `server/schema-compat.ts`
normalises them before every request:

| Shape | Rewritten to |
| --- | --- |
| `{"type": "object"}` with no properties | `properties: {}` added |
| a bare `"object"` where a schema belongs | `{"type": "object", "properties": {}}` |
| `type: ["string", "null"]` | `type: "string"`, `nullable: true` |
| `type: ["string", "number"]` | `anyOf` of single-type schemas |
| `anyOf: [X, {"type": "null"}]` | `X` with `nullable: true` |
| `default` beside a `$ref` | `default` dropped |
| `allOf` / `anyOf` / `enum` / `not` at the top level | dropped |
| a `pattern` using lookaround, e.g. `^(?!\\.)` | `pattern` dropped |

Lookaround is the one rule worth calling out: a grammar is context-free, so `(?!...)` cannot be
expressed in one *at all* — no converter will ever accept it. One such regex, on one property of
one Gmail tool, is enough to fail every request in a 67-tool set. Dropping it costs a single
advisory constraint on a single string field.

If a request still comes back with a grammar failure, the run retries once with `pattern` and
`format` stripped from every schema — both only ever narrowed a string the tool re-validates
anyway. The retry latches for the process, so it costs one failed request, not one per turn. Cloud
providers accept everything here, so the fallback never fires against them.

Detection is deliberately loose, because every server words it differently — llama-server says
`error parsing grammar`, Lemonade says `Failed to initialize samplers: failed to parse grammar`.
A grammar is only ever involved in constrained decoding, so any mention of one counts.

One error is deliberately *not* treated as a schema problem: Qwen templates raise
`No user query found` when a transcript has no user turn, and some servers wrap it in the same
"unable to generate parser" wording. Stripping keywords would not fix it, so it propagates.

## Task models

Not every model call is a chat turn. Some are short, frequent, and latency-sensitive — exactly
what a small fast model is good at. **Settings → Agent** has a **Task models** block under the
default model with one select per task; leaving one unset keeps the cheap non-LLM behaviour.

| Task | Set | Unset |
| --- | --- | --- |
| Session title | A model names the chat from its opening message | The first line is truncated |
| Context compaction | The oldest messages fold into a running summary | A long session eventually overflows |
| Tool preselection | A small model picks the turn's tools up front | The chat model loads its own, one round trip in |
| Follow-up suggestions | Three clickable next questions under a reply | Nothing under the reply |

Titling runs *alongside* the turn, not before it, so it never delays the first token — the
truncated line goes up immediately and is replaced when the title lands. A failure is swallowed:
the fallback title is already in place, and a name is not worth failing a turn over.

One wrinkle worth knowing about, because it is silent. A reasoning model asked for a six-word
title will spend its entire budget deliberating and return **empty content** — `finish_reason:
"length"`, 512 completion tokens, nothing to show. So the title call asks for thinking off, via
`reasoning_effort: "none"` and `chat_template_kwargs: {enable_thinking: false}` together, since
servers disagree about which they take. On Qwen3.6-27B that is the difference between 18s of
thinking for an empty string and 1.0s for `Python Subprocess Pipe Hang`. A server that rejects
the unknown fields gets one retry without them, and min-agent stops sending them after that.

Adding a task is a line in `MODEL_TASKS` in `shared/model-tasks.ts` and a read of
`modelForTask()`; `taskModels` is an open record, so no config migration is needed.

### Follow-up suggestions

Set a model for **Follow-up suggestions** and each reply in a chat gets up to three chips under
it — questions worth asking next, clicking one sends it:

    How do I update statistics if the planner chooses poorly?
    What exactly is index selectivity and how is it calculated?
    Can I force Postgres to use an index scan manually?

The bar is that they be *specific*. A suggestion has to be answerable from where the conversation
already is; "tell me more" is asked for explicitly and rejected. Anything longer than 80
characters is dropped rather than truncated, on the grounds that a chip you have to squint at is
worse than one fewer chip.

They are generated after the reply has streamed, not before, so the second or so they cost is
spent while the answer is being read — but it *is* a second, and the turn is not finished until
they land. Only the newest message shows them: chips further up the transcript answer questions
already moved past, and a column of them turns a chat into a menu.

### Tool preselection

On-demand loading costs a round trip. The model reads the catalogue, calls `load_tools`, gets the
schemas, and only on the step after can it do the work — every turn, before anything useful
happens. Set a model for **Tool preselection** and a small one reads the same catalogue first,
names the tools the request needs, and the turn opens with them already in hand.

The part that took measuring is what happens to the catalogue. Telling the model in the system
prompt that a tool is already loaded does not work — it calls `load_tools` anyway, because that
is what every previous turn looked like. Three framings were tried against a 67-tool router:

| Catalogue at step 0 | What the model did |
| --- | --- |
| Loaded tools marked `(loaded)` in the listing | Loaded the marked tool again |
| Loaded tools hoisted into their own section | Ignored them, worked through the siblings |
| Loaded tools dropped from the listing | Loaded repeatedly — the name appeared to vanish |
| No catalogue, no `load_tools`, shortlist only | Called the tool |

So preselection does not decorate the catalogue, it *replaces* it — for one step. When the picker
returns names, step 0 gets those tools and nothing else: no catalogue, no `load_tools`, no menu to
shop from. The saving is structural rather than persuasive; the model cannot spend a round trip on
loading because loading is not on offer.

Everything comes back on step 1, so nothing is lost if the pick was wrong — the model gets the
full catalogue and loads what it actually wanted, which is exactly where it would have been
without preselection. A picker that returns `[]` (no tools needed) leaves the normal path alone.

Preselected tools are subject to the same `MAX_PER_LOAD` cap as a `load_tools` call, and like any
loaded tool they only carry into the next turn if the model actually called one.

### Context compaction

A session that runs long eventually stops fitting. Compaction is the answer: once the last turn
reported using **75%** of the context window, the oldest messages are replaced — for the purpose
of the API call only — by one system message holding a summary of them.

Nothing is deleted. `session.compaction` records `{ summary, through, at }` and the messages stay
on disk in full; `through` is simply the index the transcript is rebuilt from, so the UI still
shows the whole history and a later fold re-summarises from the previous summary onward. That also
means the summary *accumulates* — the model is handed the old summary plus the newly folded turns
and asked for the merged one, so a fact stated in the first message survives an arbitrary number
of folds.

The cut point is the fussy part. It has to land **immediately before a `user` message**, because a
transcript that opens mid-exchange — a tool result with no assistant call above it, an assistant
turn answering nothing — is rejected by most servers. `planCompaction()` walks backwards from the
end accumulating a tail worth about 35% of the window, then advances the cut forward to the next
`user` message and gives up if that leaves fewer than two messages folded. A fold that would not
pay for itself is not worth a round trip.

Like titling, a failure is swallowed: the turn proceeds on the full transcript, which is the
behaviour you had before compaction existed.

## Turn statistics

Every turn asks the server for `usage` (via `stream_options`) and times itself, so a finished
assistant reply carries a footnote like:

    187 out · 44.7 tok/s · 420ms to first token · 4.6s · 2 tools

Throughput is measured over generation only, from the first streamed token to the last, so a slow
prefill does not drag the rate down — that wait is reported separately as *to first token*.
`2 tools` and `3 rounds` only appear when the turn actually used tools. The stats are stored with
the session, so they survive a reload.

While a turn is still streaming the server has not counted anything yet, so the line under your
message shows our own clock and a `~`-prefixed estimate derived from the streamed characters. The
exact numbers replace it when the turn ends.

The header carries the whole-conversation view: a **context meter** (`11.6k / 262k`, amber past
75%, red past 90%) and the session's running token total. The window size comes from the model
list when the server reports one — `context_length`, `max_context_window`, `max_model_len`,
`context_window` or `n_ctx` — otherwise set **Settings → Agent → Context window** by hand. Servers that
reject `stream_options` are detected once and the token-derived stats are quietly skipped.

Cost is off by default, because a local model has none. Fill in **Settings → Agent → Pricing** (dollars per
million input and output tokens) and the header total grows a `· $0.04`, with a finer per-turn
figure (`$0.0055`) in the footnote.

### What a turn does not make you wait for

Tool calls a model asks for together run together. They arrive in one round trip and do not
depend on each other, so the round trip costs the slowest of them rather than the sum, and a
result is shown the moment it lands. What is *stored* stays in call order, so the transcript
still reads the way the model wrote it. Two identical calls in one turn share a single MCP round
trip, and a call that failed is not remembered as an answer — a retry is a real retry.

Follow-up chips are written after the answer by a second, smaller model. The turn now sends
`done` as soon as the reply is complete and keeps the stream open only for the second the chips
take, so the composer unlocks with the answer instead of a beat later. A stream that idles longer
than 15 seconds — a slow tool, a model still thinking — sends a comment frame, which clients skip,
so nothing between here and the browser mistakes a working turn for a dead connection.

Stopping a turn keeps what it had already said. The assistant message used to be appended only
once the stream ended, so pressing stop left the reply on screen and nothing in the transcript;
the part that streamed is now saved before the abort is passed on.

### Watching a turn arrive

A fast model sends several hundred token deltas a second — far more than a screen can show. They
are collected in a ref and folded in on the next animation frame (`useLiveParts` in
`shared/client/`), so a burst of thirty deltas becomes one render of the same text.

That render is also made narrow. The stored transcript and each row of the in-flight turn are
separate memoised components, and `applyEvent` passes untouched parts through by reference, so a
token lands on the last bubble without re-parsing the markdown of every reply above it.

Scrolling follows the turn only while you are already within 100px of the bottom. Reading back
through the transcript mid-turn used to be impossible — every delta yanked the view down; now
leaving the bottom unpins it and a *Jump to latest* button brings it back.

### Highlighting a code fence

`shared/highlight.ts` registers a dozen languages with lowlight and flattens a fence into
`{ text, scope }` tokens, a line at a time. `mobile/components/code-block.tsx` renders them as
`<Text>` spans coloured from the `syntax` map in `mobile/lib/theme.ts` — github-dark's values,
so a fence looks the way it always has. There is no stylesheet in it, because React Native has
no `hljs-*` classes to hang one on.

The split is what keeps the interesting half testable: `tests/highlight.test.ts` exercises the
tokeniser under the root Vitest, which cannot load a React Native component, and the React
Native half holds nothing worth a test.

Registering a dozen languages by hand (`bash`, `css`, `go`, `json`, `markdown`, `python`, `rust`,
`shell`, `sql`, `typescript`, `xml`, `yaml`) rather than taking lowlight's `common` registry is
40 kB against 159 kB, and covers more than it lists: `typescript` handles JavaScript, `xml`
handles HTML. A fence tagged with something outside that set is not an error — it falls through
to auto-detection against the registered languages, and failing that comes out unhighlighted.
Inline code is left alone; the rules are hung on markdown-it's `fence` and `code_block` nodes.

Each line is its own row rather than the whole block being one string, because there is no
`white-space: pre` here: a long line can only scroll sideways if the row it sits in is a thing
that scrolls.

### Copying

A fence carries a copy button in its top corner, and a reply carries one under it — the raw
markdown as the model wrote it, not as it is drawn, because what you want out of a reply is
usually what you are about to paste somewhere that renders it. There is no text selection to
fall back on: the transcript is `<Text>` in a scroll view on Android, and dragging in it scrolls.

`mobile/lib/copy.ts` is the whole of it. There is nowhere to put a toast in this app and nothing
that owns one, so the button is its own confirmation — it turns into a tick for a moment and
goes back to offering. The tick waits on `setStringAsync` actually resolving true: a browser can
refuse the clipboard, and a button that lies about it is worse than one that does nothing.

### Retrying and editing

A reply carries a retry button beside its copy button, and a question carries a pencil to its
left. Both are the same move underneath — forget the transcript from a point, and go on from
there — so both are the one `truncateSession(id, fromIdx)` mutation rather than a delete per
message.

Where the cut falls is what makes them different. Retry cuts back to the **question**, not to
the reply it is on: a turn is the question plus every tool call and every thought the model had
about it, and the server appends the prompt itself when it runs one, so leaving the old copy
behind would ask it twice. Edit cuts to the question and puts its text in the composer, which
is the same thing with the sending left to you.

Only a suffix is ever removed, which is what keeps `idx` dense and lets the client go on
treating a message's position in the array as its index. The session's own columns are derived
again rather than decremented — `messageCount` is where the transcript now ends, and the banked
usage is what the remaining turns add up to — because a decrement has to trust that the rows and
the totals never drifted, and this does not. A compaction that summarised anything past the cut
is dropped: it describes messages that no longer exist, and the next turn would send it as
though they did.

Neither button is offered while a turn is running. There is one stream and one composer, and
rewinding underneath a reply that is still arriving has no sensible reading.

## Keyboard shortcuts

| | |
| --- | --- |
| `⌘`/`Ctrl` + `N` | New chat |
| `⌘`/`Ctrl` + `K` | Focus the session search |
| `⌘`/`Ctrl` + `,` | Settings |
| `Esc` | Close a dialog or a select sheet; give up a rename |

Browser and desktop only. The Electron build is the web build, and a phone has no keyboard to
press them with, so on native `useShortcut` registers nothing.

`mobile/lib/keys.ts` is one `keydown` listener for the whole app rather than one per screen: a
shortcut belongs to the window, and screens come and go under it. Components say what they
answer to with `useShortcut(combo, handler)`, and passing `undefined` for the handler declines
the key rather than binding it to nothing — the search box takes `⌘K` only while it is on
screen, because a shortcut that silently does nothing is worse than one the browser still owns.

Bindings are a stack per combo and only the last one runs, which is what Escape needs: a dialog
opened over a screen that already answers to Escape should be the thing that closes, and it
should hand the key back when it goes. Chords fire wherever the caret is — `⌘K` while writing a
message is exactly when you want it — and so does Escape; a bare key would not, and is ignored
while a text box has focus.

New chat and Settings are bound in the sidebar rather than in the list, because the nav is the
one thing mounted on every route and they would otherwise stop working the moment you opened
Settings. Escape closing a modal is not bound here at all: react-native-web's `Modal` already
turns it into `onRequestClose`, which `Dialog` and `Select` were passing before any of this.

One caveat: a browser will not give up `⌘N`, so that one only reaches us in Electron.

## The session list

Chats sit under **Today**, **Yesterday**, **This week** and **Earlier**. Every row used to
carry a full `Nov 12, 03:14`, which is noise past a screenful — the dates repeat, and none of
them is the one you are looking for. Under a heading a row only says what the heading does not:
a clock today, a weekday earlier in the week, a date once it is older than that.

The buckets are `groupSessions` in `shared/client/sessions.ts`, next to `matchSessions`, so the
rule is testable from the root runner and the panel and the narrow screen — which render the
same list twice — cannot drift apart. Days are counted between midnights rather than in elapsed
hours: at nine in the morning something from eleven last night is yesterday, not fourteen hours
ago. The difference is rounded, because the two midnights can be 23 or 25 hours apart when the
clocks change and a chat should not slide into the wrong day over it.

A chat is renamed in place — the title becomes a field, Enter or moving away commits, Escape
puts it back — over the `updateSessionSingle` mutation the generated CRUD hands us for free.

Delete asks first. The bin primes the row into a `Delete?` button rather than opening a dialog:
one tap to arm, one to confirm, and the row disarms itself after five seconds so a forgotten
click is not a delete waiting to happen. There is no modal, which also means no `Alert.alert` —
react-native-web does not implement it, and the same code runs in a browser.

A search box appears above the list once there are more than eight chats — below that, scanning
is faster than the box is worth. It matches every whitespace-separated term against the title, in
any order, so typing more always narrows.

The rule is `matchTerms` in `shared/client/search.ts`, and it is the only one in the app: the
same eight-item threshold and the same matching turn up inside `Select`, which grows a filter box
when there is a long list behind it — the models one, on an Ollama box with forty tags on it,
being the list that made the case. Filtering is done in the client in both places: what is being
filtered is already in memory, and a round trip per keystroke would be slower than the scanning
it replaced.

## Other apps in the sidebar

The other things you run — a kanban board, a task server — can have a row in min-agent's nav
without being part of min-agent. **Settings → Apps** is a list of addresses; each one becomes a
sidebar item, and opening it puts that server's own UI in an iframe filling the content area.

```
Label    what the sidebar row says
URL      an absolute http/https address
Icon     a Feather glyph, picked from a grid of the dozen on offer
Opens    "In a frame", or "In the browser"
```

Nothing is proxied, re-skinned or shared. The framed app talks to its own server, keeps its own
session, and behaves exactly as it does in its own tab — min-agent knows its address and nothing
else. That is the point: two apps, one window, no integration to keep in step.

Three things follow from it, and each is why something in the UI looks the way it does.

**A server can refuse to be framed, invisibly.** `X-Frame-Options: DENY` and a `frame-ancestors`
CSP are enforced by the browser, and a blocked frame is a blank rectangle with no event for the
page to catch — there is no way to detect it and say so. So every embed view carries **Open in
the browser** in its header whether or not anything has gone wrong, and any app that will not
frame can be switched to `external` mode, where its sidebar row hands the URL straight to the
browser and never routes into min-agent at all.

**The URL is stored once, for every device.** The list is a table in Postgres like the settings
and the MCP servers, so the browser, the Android app and the desktop build all read the same
rows — and `http://localhost:3000` means a different machine on each of them. Use the address
the app is reachable at from the LAN.

**Android has no frame to put anything in.** There is no WebView compiled into the build, so
every app opens in the browser there regardless of its mode; the embed view says so rather than
showing an empty screen.

`javascript:` and `data:` URLs are rejected on the way into the database (`embedSchema` in
`shared/types.ts`). An iframe `src` and `Linking.openURL` are both places the browser is told to
go, and a script URL in either would run in min-agent's own origin.

The sidebar rows are not routes. There is one `embed/[id]` screen behind all of them, hidden from
the drawer the way `chat/[id]` is, and `Sidebar` in `mobile/app/_layout.tsx` draws a `DrawerItem`
per row from the query — the drawer's own `DrawerItemList` can only render screens that exist in
the file tree, and these come from the database.

## Android and Windows

`mobile/` is the front end — Expo (React Native) with expo-router and NativeWind — and it ships
to three places from one source: the browser through react-native-web, Android, and Windows or
Linux through Electron. The browser build is the one `npm start` and the Docker image serve at
`/`; the other two are the same code with a different bundler target and one panel they cannot
do without, **Settings → Server**, covered below.

It installs separately. Metro pins `nodeModulesPaths` to `mobile/node_modules`, so the app has
its own `package.json` and its own lockfile rather than being a workspace of the root — which is
also what keeps `graphql`, zod and the server's dependencies out of reach of the bundle.

```bash
npm install --prefix mobile
npm run mobile              # Expo dev server: press a for Android, w for web
npm run mobile:android      # straight to a connected device or emulator
```

### What `shared/` is for

With one front end, `shared/` is no longer two clients agreeing with each other — it is the
client and the server agreeing. `shared/types.ts`, `shared/messages.ts`, `shared/model-tasks.ts`
and `shared/graphql/` are read from both sides, so a stored row, a chat-completions message and
the shape of a query are each defined once. `shared/client/` is the client's half of that — the
transport, the API calls, the SSE stream reader, the live-event reducer and the usage/cost
formatting — and it lives at the root rather than in `mobile/` because none of it touches React
Native, which is what lets the tests run it.

What is *not* shared is the validation. `shared/types.ts` carries zod schemas as well as types,
but only the server imports them: a client that parses the settings row on arrival is defending
against a case GraphQL has already ruled out, and it costs 82 kB to do it. Take the types from
there with `import type`, never a bare `import { type A }` — under `verbatimModuleSyntax` the
latter is still a value import, and one of them puts the whole validator back in the bundle.

`mobile/components/ui.tsx` keeps shadcn's component and variant names
(`<Button variant="outline" size="sm">`) even though there is no Radix and no DOM under them.
That is deliberate: it is the vocabulary the screens were written in, and a React Native widget
set that answers to the same names is one less thing to translate when a view moves.

### A sidebar, not a hamburger

On the web the nav is always on screen. `drawerType: "permanent"` pins it beside the
content and takes the toggle out of the header, so the destinations are a sidebar rather
than something you have to remember is there. Above 768px it shows icons and labels; below, it
narrows to a 64px rail of icons that the button at its top opens back out — a nav you can still
see and click at 400px wide, which a closed drawer is not.

The rail hides its labels with `display: none` on `drawerLabelStyle` rather than dropping
them, so each icon is still announced by name. On a phone none of this applies: the drawer
goes on sliding over the content, because 64px of permanent rail is a lot of a phone.

`drawerContent` is min-agent's own `Sidebar` on every platform, not just the web: below the
screens it draws a row per configured app (see [Other apps in the
sidebar](#other-apps-in-the-sidebar)), and under a spacer at the foot of the list, Settings.
Both exist on the phone too. Only the fold-out button is web-only, and it is passed in rather
than assumed.

### One settings page

There is one thing to configure and one row that opens it. `mobile/app/settings.tsx` is a tab
bar over four panels in `mobile/components/settings/`:

```
Agent    the model, the key, the prompt, the limits, task models, pricing
MCP      the servers, their transports and their live status
Apps     the other apps that get a sidebar row
Server   which min-agent server this build talks to
```

These were four sibling entries in the drawer, which put the four things you set up once at the
same level as the one thing you use all day, and left Settings meaning only the last of them.
The drawer is the app's nav, not its preferences pane.

The panels are components rather than files under `app/` because every file under `app/` is a
route, and only the tab bar is a destination now. `/settings?tab=mcp` opens on one — the param
seeds the state, and the state is what the row reads, so a tab is never dead on a platform
where the URL is not an address bar. Each panel renders its own `Screen` and owns its own
loading, error and save states.

A panel is mounted the first time you open its tab and kept from then on, hidden rather than
unmounted. The panels hold drafts — a half-written system prompt, a server address typed but
not tested — and unmounting one threw its draft away without ever saying so. What is kept is a
live component and its queries, not a snapshot, so each panel is told whether it is the one on
screen: the MCP poll runs at five seconds while you are looking at it and stops when you are
not, and an open dialog is hidden along with its panel rather than left floating over the next
one, because a `Modal` is drawn outside the tree it is written in.

Nothing blocks you from leaving a draft behind. `components/settings/dirty.tsx` is how the tab
row finds out: a panel reports whether it is holding something unsaved, and the tab gets a dot
(`Tabs` takes `marks` — a muted dot for unsaved, a red one for the MCP servers that stopped
answering, which outranks it). The Agent panel is three cards long, so its Save is pinned under
the form instead of at the end of it, and shows up only when there is a change to keep or a
save to confirm — with a Revert beside it, now that a draft can outlive the tab it was typed
in. Dirty is measured against the stored row rather than set by a keystroke, so putting a value
back the way it was is not a change.

Settings is drawn by hand in `Sidebar` rather than by `DrawerItemList`, for its position alone:
it is hidden from the generated list and repeated under a `flex: 1` spacer, which is what puts
it at the bottom of a drawer whose content container grows to fill the height.

The tab table is `mobile/components/settings/tabs.ts`, and `SettingsLink` reads it too. Every
place that reports something unconfigured — no model picked, the server not answering, an
`/embed/<id>` with no row behind it — carries a button to the panel that fixes it rather than
naming a screen and leaving you to find it. That is also the guard against the copy going
stale: a link names its panel the way the tab does, from the one table.

### One chats view, two widths

A wide screen has room for the conversation on the left and the session list in a panel on the
right; a phone has never had room for both. `mobile/components/chat-view.tsx` is both: above
768px (`useWide()` in `mobile/lib/layout.ts`) it renders the chat and the panel side by side,
and below it the list and the chat go back to being separate screens at `/` and `/chat/[id]`.

The split is a JavaScript branch rather than a `md:` class because it decides *which panes
exist*, not how one is styled — and `useWindowDimensions` re-renders on rotation and on a
dragged browser window, so a resize moves the layout rather than leaving it at whatever
width the app started at. Both routes render `ChatsView`, which is what lets the panel stay
put while the route beneath it changes; switching chats from the panel `replace`s rather
than `push`es, so an afternoon of browsing does not pile up on the back stack.

Enter sends in the browser, and Shift+Enter breaks the line. That is wired through `onKeyPress`
in `Textarea` and is deliberately web-only: on a phone the return key is how
you get a new line, and the send button is an inch away. react-native-web hands `onKeyPress`
the React synthetic keyboard event rather than the bare `{ key }` its types promise, so the
handler reads `shiftKey` and the IME's `isComposing` through a documented cast — and calls
`preventDefault()`, which also suppresses react-native-web's own Enter branch and the blur
that comes with it, so the cursor stays in the box between messages.

### A pinned lightningcss

`mobile/package.json` pins `lightningcss` to `1.30.1` for `react-native-css`, and the pin is
load-bearing: without it the Android bundle does not build at all.

NativeWind compiles the stylesheet for native by running lightningcss with a `StyleSheetExit`
visitor — the whole sheet crosses into JS and back. From **1.30.2** that round trip stops working:
any `var()` fails with `failed to deserialize; expected an object-like struct named Specifier,
found ()`, and an `@property` without an `initial-value` fails the same way naming
`ParsedComponent`. Tailwind's output is full of both, so the export dies on `global.css` with no
indication of which line is at fault. The web build is unaffected, because it never takes that
path — which is exactly why this survived a working web export.

1.30.1 is the newest version whose round trip is intact, and it satisfies `@expo/metro-config`'s
`^1.30.1`. The pin is scoped to `react-native-css` so Tailwind keeps its own copy.

### A scoped NativeWind Babel plugin

`mobile/babel.config.js` does not use `nativewind/babel` as-is. It wraps the preset's import
plugin so that it skips any file under `react-native-web/dist`.

That plugin is what makes `className` work on web: it rewrites imports of react-native-web's
components to react-native-css's className-aware wrappers. It also fires inside react-native-web
itself, and there it is a cycle. `Animated` pulls in `AnimatedFlatList`, which is rewritten to the
FlatList wrapper, which imports the `react-native` barrel — the same barrel that was part-way
through loading FlatList. Its `FlatList` getter then reads `.default` off a binding that has not
been assigned yet, and the app dies at import time with `Cannot read properties of undefined
(reading 'default')` before it renders anything.

react-native-css's Metro resolver already refuses to rewrite anything inside react-native-web; its
Babel plugin has no equivalent guard. Adding one costs nothing, because the wrappers are still
substituted wherever the app — or any other package — imports a component, which is the only place
`className` has to reach.

The other deliberate version choice is TypeScript. SDK 57 expects `~6.0.3`; this app is on `^7.0.2`
so it matches the repo root, and `expo.install.exclude` in `mobile/package.json` stops
`expo-doctor` reporting the gap. Both exports and all 21 doctor checks pass on it.

### Unlayered Tailwind utilities

`mobile/global.css` imports `tailwindcss/theme.css` and `tailwindcss/utilities.css` separately
rather than `@import "tailwindcss"`, and the utilities go in unlayered.

`@import "tailwindcss"` would put every utility in `@layer utilities`. react-native-web gives each
component a base class — `padding: 0`, `border: 0 solid black`, `background-color: transparent`,
`flex-direction: column` — in a plain, unlayered stylesheet, and an unlayered rule beats a layered
one no matter what the layer order or the specificity is. Layered utilities therefore lose every
property that base class happens to set: `p-4` renders with no padding, `flex-row` stays a column,
`border` and `bg-*` do nothing, while `gap-4` and `rounded-xl` — which the base class says nothing
about — still work, which is what makes the failure so confusing to look at. Unlayered, the
utilities are in the same cascade as react-native-web and win on document order.

Preflight is left out: react-native-web has its own reset, and the app renders no bare HTML
elements for preflight to fix.

The palette is dark, full stop — one `:root`, no `prefers-color-scheme` block, `userInterfaceStyle`
pinned to `dark` in `app.json`. There is no light mode to follow the device into, and adding one
would mean a second value for every colour in three places rather than one.
`mobile/lib/theme.ts` carries the same values as hex for the props that take a colour as a string
rather than a class, and `app/_layout.tsx` hands them to react-navigation, which paints the drawer
and header itself. Those theming primitives are imported from `expo-router`, not from
`@react-navigation/native` — SDK 56 and later refuse to let app code import the latter directly.

### Pointing it at your server

Three things are tried, in order, and the first that works wins:

1. **What you saved under Settings → Server.** Always wins, on every platform.
2. **The origin that served the page** — right for the build the server serves, and right
   whatever host you reach it at, so a phone browser opening `http://framework.lan:8787` needs
   no setup. Being on the web is not the same as having been served by the agent, though:
   `expo start --web` serves the app from Metro, and Metro answers every path it does not
   recognise with `index.html`, so an origin-relative `/graphql` comes back as `<!DOCTYPE html>`
   and every screen fails on a JSON parse. The app asks rather than assumes — it posts the
   `health` query to `/graphql` once and moves on unless the answer is JSON.
3. **The address baked in at build time**, `EXPO_PUBLIC_AGENT_URL`. `scripts/expo.ts` sets it from
   the same `PORT` the server reads, so moving the server does not mean editing the app. This is
   why the Expo scripts are run from the repo root — `npm run mobile:web`, not `npm --prefix
   mobile run web`, which skips the launcher and leaves the app guessing 8787.

Metro caches the transform that inlines `EXPO_PUBLIC_*`, and the cache key does not include the
value, so a changed address would otherwise be quietly ignored in favour of the one already
compiled in. The launcher remembers the last address in `mobile/.expo/agent-url` and passes
`--clear` when it has moved.

Android and the desktop build have no origin to inherit and no useful `localhost`, so they are the
case that panel exists for: open **Settings → Server**, put in the address of the machine running `npm start`
— `http://framework.lan:8787`, say — and press **Save and test**. It is remembered on the device,
and the badge tells you whether the server answered.

There is no auth. The API is served with a permissive CORS header so the app can reach it from
another origin, which means anything on the network that can reach port 8787 can use your agent.
Keep it on a network you trust, or put it behind something that does authenticate.

Android additionally needs cleartext HTTP to be allowed, since a LAN server is rarely on https;
`app.json` sets `usesCleartextTraffic` for that reason.

### Web build

```bash
npm run mobile:export       # -> mobile/dist
npm start                   # express serves it at http://localhost:8787
```

`npm run build` is the same export with codegen and a typecheck in front of it, and is what the
Docker image runs. Express serves `mobile/dist` at `/` and answers anything that is not
`/graphql` with `index.html`, so a deep link like `/chat/3` survives a reload; the fingerprinted
files under `_expo/static/` are the only ones cached immutably.

### Windows desktop

The Electron shell wraps the same web export.

```bash
npm install --prefix mobile/electron
npm run desktop             # export, then run the shell
npm run desktop:build       # export, then package -> mobile/electron/release
```

`desktop:build` produces an NSIS installer and a portable `.exe` on Windows (`npm run dist:linux`
in `mobile/electron` gives an AppImage). The shell serves the bundle over a loopback HTTP server
rather than `file://`, because the export's asset URLs are absolute and `localStorage` — where the
server address is kept — is unreliable on a file origin.

## Scripts

| Script            | What it does                        |
| ----------------- | ----------------------------------- |
| `npm run dev`     | codegen, server and app, all watching |
| `npm run db:generate` | write a migration for a schema change |
| `npm run db:migrate` | apply pending migrations         |
| `npm run db:studio` | browse the database              |
| `npm run codegen` | print `schema.graphql`, regenerate `shared/gql/` |
| `npm run build`   | codegen, typecheck, then export to `mobile/dist` |
| `npm start`       | serve API + `mobile/dist` on `:8787` |
| `npm run typecheck` | `tsc --noEmit`                    |
| `npm run lint`    | `biome check .`                     |
| `npm run format`  | `biome check --write .`             |
| `npm test`        | `vitest run`                        |
| `npm run test:watch` | `vitest` in watch mode           |
| `npm run mobile`  | Expo dev server for the `mobile/` app |
| `npm run mobile:android` | build and run on Android      |
| `npm run mobile:web` | Expo in the browser              |
| `npm run mobile:export` | web build -> `mobile/dist`, served at `/` |
| `npm run mobile:typecheck` | `tsc --noEmit` in `mobile/`  |
| `npm run desktop` | export, then run the Electron shell |
| `npm run desktop:build` | export, then package the desktop app |

## License

[MIT](LICENSE) © Benjamin Van Treese
