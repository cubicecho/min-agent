# min-agent

A very small self-hosted agent: chat sessions over any OpenAI-compatible server, with MCP tools.
Replies render as markdown with syntax-highlighted code, and every turn reports what it cost in
tokens, time and throughput. Config lives in YAML files you can edit by hand; sessions live as
JSON on disk.

## Contents

Everything below the quick start is reference — read it when you want that piece, not in order.

- [Quick start](#quick-start) · [Production](#production) · [Docker](#docker) — running it
- [Layout](#layout) · [Files on disk](#files-on-disk) · [Scripts](#scripts) — finding your way around
- [MCP servers](#mcp-servers) — wiring up tools, and how they are loaded without blowing the prompt budget
- [Task models](#task-models) — pointing a small fast model at titling, compaction, tool preselection and follow-ups
- [Turn statistics](#turn-statistics) — what the numbers under each reply mean
- [The session list](#the-session-list) — renaming, deleting and finding a chat
- [Android, Windows and web apps](#android-windows-and-web-apps) — the second front end in `mobile/`

## Stack

Vite + React 19 + TanStack Router/Query + shadcn (Tailwind v4) on the front, a minimal Express 5
server on the back. TypeScript everywhere, Biome for lint/format, Vitest for tests.

There is a second front end in `mobile/` — Expo + expo-router + NativeWind — that builds the same
views for Android, Windows (via Electron) and the web. See
[Android, Windows and web apps](#android-windows-and-web-apps).

## Quick start

```bash
npm install
npm run dev      # api on :8787, web on 0.0.0.0:3000 (proxies /api)
```

Open http://localhost:3000, go to **Config**, point it at an OpenAI-compatible server, hit
**Refresh** to list models, pick one, **Save**.

Known-good base URLs:

| Server    | Base URL                       | API key            |
| --------- | ------------------------------ | ------------------ |
| Ollama    | `http://localhost:11434/v1`    | not needed         |
| LM Studio | `http://localhost:1234/v1`     | not needed         |
| OpenAI    | `https://api.openai.com/v1`    | `sk-…`             |
| OpenRouter| `https://openrouter.ai/api/v1` | `sk-or-…`          |

The key can also come from `OPENAI_API_KEY` in the environment (see `.env.example`); the value
saved in `config/llm.yaml` wins if both are set.

### Where it listens

Copy `.env.example` to `.env` to change it. Both `npm run dev` and `npm start` read that file —
Node loads it directly, through `--env-file-if-exists`, so there is no dotenv dependency and no
import to remember — and the Vite dev server reads the same file so its `/api` proxy follows the
server rather than going on knocking at 8787.

`PORT` is the Express port. `HOST` is the interface it binds; the default, `0.0.0.0`, accepts
connections from the LAN, which is what the Android and desktop apps need to reach it at all.
Setting it to `localhost` takes that back and accepts local connections only — worth doing on a
network you do not trust, since nothing here is authenticated. The startup line prints an address
you can actually open, so a wildcard bind shows as `localhost`.

## Production

```bash
npm run build    # typecheck + vite build -> dist/
npm start        # express serves the API and dist/ on :8787
```

## Docker

```bash
docker compose up -d          # http://localhost:8787
```

The image is the server and the web client, nothing else. It stays a full `node` image rather
than something smaller because MCP stdio servers are spawned as child processes and an stdio
server is usually `npx something`, which needs npm and a network from inside the container.

Config and sessions both live in the one `/data` volume — `MIN_AGENT_CONFIG_DIR` and
`MIN_AGENT_DATA_DIR` are set to point there — so `./docker-data` is what to keep and what to
back up. Both are seeded on first boot, so an empty directory is the right starting point.

An LLM server running on the host machine is `http://host.docker.internal:11434/v1` from in
here, not `localhost`; the compose file maps that name on Linux, where Docker does not provide
it. Nothing in min-agent is authenticated, so publish the port on a network you trust — or bind
it to `127.0.0.1:8787:8787` and put something with a login in front.

The Expo bundle served at `/app` is deliberately not built into the image: it would mean
installing React Native and Metro to produce a second copy of a UI already served at `/`. Run
`npm run mobile:export` on the host and mount `mobile/dist` if you want it there too.

## Releases

`.github/workflows/ci.yml` lints, tests and builds on every push and pull request, typechecks
the Expo app in a job of its own, and builds the image and boots it far enough to answer
`/api/health` — so a broken Dockerfile is caught before there is a version number riding on it.

`.github/workflows/release.yml` runs after a green CI on `main`. semantic-release reads the
commit messages, and if they amount to a release it tags one and pushes the image to both
`ghcr.io/vantreeseba/min-agent` and, optionally, Docker Hub. GHCR needs no setup — the workflow's
own `GITHUB_TOKEN` can push to it. Docker Hub is published to only when `DOCKERHUB_USERNAME` and
`DOCKERHUB_TOKEN` are in the repository secrets; without them those steps are skipped and the
release still goes out to GHCR. A run of chores publishes nothing.

## Layout

- `src/` — web client. `routes/` is one file per nav item, `components/app-shell.tsx` is the frame.
- `mobile/` — the Expo client. `app/` is one file per route, `components/ui.tsx` is the widget set,
  `electron/` is the desktop shell.
- `server/` — express. `agent.ts` is the tool-calling loop, `mcp.ts` the MCP client pool,
  `store.ts` session persistence, `config.ts` YAML read/write.
- `shared/types.ts` — zod schemas shared by both sides; the API contract lives here.
- `shared/client/` — everything both front ends run: `api.ts` (the typed client and the SSE
  reader), `live.ts` (streaming-event reducer), `use-live-parts.ts` (frame-batched streaming
  state), `sessions.ts` (the session-list filter), `usage.ts` (token/cost formatting).
- `tests/` — Vitest (`npm test`).

## Files on disk

Created on first run, both git-ignored.

```
config/llm.yaml     LLM connection + agent settings (Config view)
config/mcp.yaml     MCP servers (MCP Servers view)
data/sessions/*.json         one file per chat session
data/sessions/*.meta.json    title, dates and token totals, for the session list
```

Override the locations with `MIN_AGENT_CONFIG_DIR` / `MIN_AGENT_DATA_DIR`.

The `.meta.json` beside each session is a cache, not a source: the sidebar is refetched after
every turn, and reading it means listing sessions no longer parses every message of every
conversation on disk to print a column of titles. Each one records the size and mtime of the
transcript it describes, so a session file you edit by hand is noticed and its summary rebuilt on
the next listing. Deleting the sidecars is safe — they come back.

Editing the YAML by hand is supported and is often faster than the UI — the server re-reads on
each request. Note that saving from the UI rewrites the file and drops your comments.

## MCP servers

Both transports are supported:

```yaml
servers:
  - id: fs
    label: Filesystem
    enabled: true
    transport: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
  - id: docs
    transport: http
    url: https://example.com/mcp
```

Tools are exposed to the model as `<server id>__<tool name>`, so ids must be unique and short.

### On-demand tool loading

A tool definition is mostly JSON Schema, and eagerly sending every one of them on every request is
usually the largest thing in the prompt — 34 tools cost about 11.5k tokens per request here, paid
whether or not the model touches a single one.

**Config → MCP tools** picks how they are sent:

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
what a small fast model is good at. Config has a **Task models** block under the default model
with one select per task; leaving one unset keeps the cheap non-LLM behaviour.

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

Adding a task is a line in `MODEL_TASKS` in `shared/types.ts` and a read of `modelForTask()`;
`taskModels` is an open record, so no config migration is needed.

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
`context_window` or `n_ctx` — otherwise set **Config → Context window** by hand. Servers that
reject `stream_options` are detected once and the token-derived stats are quietly skipped.

Cost is off by default, because a local model has none. Fill in **Config → Pricing** (dollars per
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

A fast model sends several hundred token deltas a second — far more than a screen can show. Both
front ends collect them in a ref and fold them in on the next animation frame (`useLiveParts` in
`shared/client/`), so a burst of thirty deltas becomes one render of the same text.

That render is also made narrow. The stored transcript and each row of the in-flight turn are
separate memoised components, and `applyEvent` passes untouched parts through by reference, so a
token lands on the last bubble without re-parsing the markdown of every reply above it.

Scrolling follows the turn only while you are already within 100px of the bottom. Reading back
through the transcript mid-turn used to be impossible — every delta yanked the view down; now
leaving the bottom unpins it and a *Jump to latest* button brings it back.

## The session list

Both front ends render the same rail from the same pieces. A chat is renamed in place — the
title becomes a field, Enter or moving away commits, Escape puts it back — which is the whole
of the `PATCH /sessions/:id` route the server has always had and nothing had ever called.

Delete asks first. The bin primes the row into a `Delete?` button rather than opening a dialog:
one tap to arm, one to confirm, and the row disarms itself after five seconds so a forgotten
click is not a delete waiting to happen. There is no modal on either platform, which also means
no `Alert.alert` — react-native-web does not implement it, and the mobile app runs in a browser.

The row's buttons used to be `hidden group-hover:block` on the web, so they did not exist for a
keyboard or a touchscreen. They now fade in on hover *or* focus-within, and stay visible where
there is no hover at all (`[@media(hover:none)]`).

A search box appears above the list once there are more than eight chats — below that, scanning
is faster than the box is worth. It matches every whitespace-separated term against the title, in
any order, so typing more always narrows. Filtering is done in the client (`matchSessions` in
`shared/client/sessions.ts`): the list is already in memory, and a round trip per keystroke would
be slower than the search it replaced.

## Android, Windows and web apps

`mobile/` is a second front end over the same server: Expo (React Native) with expo-router and
NativeWind, shipping to Android, to Windows and Linux through Electron, and to the browser. It has
the same views as the web app — Chats, MCP Servers, Config — and one extra, **Settings**,
covered below.

```bash
npm install --prefix mobile
npm run mobile              # Expo dev server: press a for Android, w for web
npm run mobile:android      # straight to a connected device or emulator
```

### What is actually shared

`shared/types.ts` and `shared/client/` are used byte-identically by both clients — the zod
contract, the API calls, the SSE stream reader, the live-event reducer and the usage/cost
formatting. That is the part worth sharing and the part that would otherwise drift.

The *widgets* are not shared, and cannot be: `src/components/ui/` is shadcn, which is Radix, which
is the DOM. `mobile/components/ui.tsx` is a React Native re-implementation that keeps the same
component and variant names (`<Button variant="outline" size="sm">`), so the screens read the same
either side even though nothing under them is.

### A sidebar, not a hamburger

On the web the nav is always on screen. `drawerType: "permanent"` pins it beside the
content and takes the toggle out of the header, so the five destinations are a sidebar the
way they are in the Vite app rather than something you have to remember is there. Above
768px it shows icons and labels; below, it narrows to a 64px rail of icons that the button
at its top opens back out — a nav you can still see and click at 400px wide, which a
closed drawer is not.

The rail hides its labels with `display: none` on `drawerLabelStyle` rather than dropping
them, so each icon is still announced by name. On a phone none of this applies: the drawer
goes on sliding over the content, because 64px of permanent rail is a lot of a phone.

### One chats view, two widths

The web app puts the conversation on the left and the session list in a panel on the right;
the phone has never had room for both. `mobile/components/chat-view.tsx` is both: above
768px (`useWide()` in `mobile/lib/layout.ts`) it renders the chat and the panel side by side,
and below it the list and the chat go back to being separate screens at `/` and `/chat/[id]`.

The split is a JavaScript branch rather than a `md:` class because it decides *which panes
exist*, not how one is styled — and `useWindowDimensions` re-renders on rotation and on a
dragged browser window, so a resize moves the layout rather than leaving it at whatever
width the app started at. Both routes render `ChatsView`, which is what lets the panel stay
put while the route beneath it changes; switching chats from the panel `replace`s rather
than `push`es, so an afternoon of browsing does not pile up on the back stack.

Enter sends, as it does on the web, and Shift+Enter breaks the line. That is wired through
`onKeyPress` in `Textarea` and is deliberately web-only: on a phone the return key is how
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
pinned to `dark` in `app.json`. The web app hard-codes `class="dark"` and has no light mode, so
following the device would have meant the two front ends disagreeing on any machine set to light.
`mobile/lib/theme.ts` carries the same values as hex for the props that take a colour as a string
rather than a class, and `app/_layout.tsx` hands them to react-navigation, which paints the drawer
and header itself. Those theming primitives are imported from `expo-router`, not from
`@react-navigation/native` — SDK 56 and later refuse to let app code import the latter directly.

### Pointing it at your server

Three things are tried, in order, and the first that works wins:

1. **What you saved under Settings.** Always wins, on every platform.
2. **The origin that served the page** — right for the `/app` build, and right whatever host you
   reach it at, so a phone browser opening `http://framework.lan:8787/app` needs no setup. Being
   on the web is not the same as having been served by the agent, though: `expo start --web`
   serves the app from Metro, and Metro answers every path it does not recognise with
   `index.html`, so an origin-relative `/api/config` comes back as `<!DOCTYPE html>` and every
   screen fails on a JSON parse. The app asks rather than assumes — it probes `/api/config` once
   and moves on unless the answer is JSON.
3. **The address baked in at build time**, `EXPO_PUBLIC_AGENT_URL`. `scripts/expo.ts` sets it from
   the same `PORT` the server reads, so moving the server does not mean editing the app. This is
   why the Expo scripts are run from the repo root — `npm run mobile:web`, not `npm --prefix
   mobile run web`, which skips the launcher and leaves the app guessing 8787.

Metro caches the transform that inlines `EXPO_PUBLIC_*`, and the cache key does not include the
value, so a changed address would otherwise be quietly ignored in favour of the one already
compiled in. The launcher remembers the last address in `mobile/.expo/agent-url` and passes
`--clear` when it has moved.

Android and the desktop build have no origin to inherit and no useful `localhost`, so they are the
case Settings exists for: open **Settings**, put in the address of the machine running `npm start`
— `http://framework.lan:8787`, say — and press **Save and test**. It is remembered on the device,
and the badge tells you whether the server answered.

There is no auth. The API is served with a permissive CORS header so the app can reach it from
another origin, which means anything on the network that can reach port 8787 can use your agent.
Keep it on a network you trust, or put it behind something that does authenticate.

Android additionally needs cleartext HTTP to be allowed, since a LAN server is rarely on https;
`app.json` sets `usesCleartextTraffic` for that reason.

### Web build

```bash
npm run mobile:export       # -> mobile/dist, base URL /app
npm start                   # express serves it at http://localhost:8787/app
```

Both front ends can be served at once: `/` is the Vite app, `/app` is the Expo one.

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
| `npm run dev`     | server + web with reload            |
| `npm run build`   | typecheck, then build to `dist/`    |
| `npm start`       | serve API + `dist/` on `:8787`      |
| `npm run typecheck` | `tsc --noEmit`                    |
| `npm run lint`    | `biome check .`                     |
| `npm run format`  | `biome check --write .`             |
| `npm test`        | `vitest run`                        |
| `npm run mobile`  | Expo dev server for the `mobile/` app |
| `npm run mobile:android` | build and run on Android      |
| `npm run mobile:web` | Expo in the browser              |
| `npm run mobile:export` | web build -> `mobile/dist`, served at `/app` |
| `npm run mobile:typecheck` | `tsc --noEmit` in `mobile/`  |
| `npm run desktop` | export, then run the Electron shell |
| `npm run desktop:build` | export, then package the desktop app |

## License

[MIT](LICENSE) © Benjamin Van Treese
