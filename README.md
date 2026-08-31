# min-agent

A very small self-hosted agent: chat sessions, MCP tools, and cron jobs that run a prompt on a
schedule. Replies render as markdown with syntax-highlighted code, every turn reports what it cost
in tokens, time and throughput, and each cron job keeps a run history. Config lives in YAML files you can edit by hand;
sessions live as JSON on disk.

## Stack

Vite + React 19 + TanStack Router/Query + shadcn (Tailwind v4) on the front, a minimal Express 5
server on the back. TypeScript everywhere, Biome for lint/format, Vitest for tests.

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

## Production

```bash
npm run build    # typecheck + vite build -> dist/
npm start        # express serves the API and dist/ on :8787
```

## Layout

- `src/` — client. `routes/` is one file per nav item, `components/app-shell.tsx` is the frame.
- `server/` — express. `agent.ts` is the tool-calling loop, `mcp.ts` the MCP client pool,
  `cron.ts` the scheduler, `store.ts` session persistence, `config.ts` YAML read/write.
- `shared/types.ts` — zod schemas shared by both sides; the API contract lives here.
- `tests/` — Vitest (`npm test`).

## Files on disk

Created on first run, both git-ignored.

```
config/llm.yaml     LLM connection + agent settings (Config view)
config/mcp.yaml     MCP servers (MCP Servers view)
config/crons.yaml   scheduled jobs (Cron view)
data/sessions/*.json    one file per chat session
data/cron-runs.json     last 20 runs per cron job
```

Override the locations with `MIN_AGENT_CONFIG_DIR` / `MIN_AGENT_DATA_DIR`.

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

Two things keep it robust. A model that skips `load_tools` and calls a catalogued tool directly by
name gets it loaded and executed anyway rather than an "unknown tool" error. And what a session
loads stays loaded for the rest of that session, stored as `loadedTools`, so a follow-up question
about the same files does not pay the discovery step twice.

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

If a request still comes back with a grammar failure, the run retries once with `pattern` and
`format` stripped from every schema — the converter rejects escape classes like `\d` and most
`format` values, and both only ever narrowed a string the tool re-validates anyway. The retry latches
for the process, so it costs one failed request, not one per turn. Cloud providers accept everything
here, so the fallback never fires against them.

One error is deliberately *not* treated as a schema problem: Qwen templates raise
`No user query found` when a transcript has no user turn, and some servers wrap it in the same
"unable to generate parser" wording. Stripping keywords would not fix it, so it propagates.

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

## Cron

Standard 5- or 6-field cron expressions (`node-cron`). The Cron view is a list — click a row to
edit it in a dialog, or use the trash icon to delete it. Each job has its own prompt and an
optional model override; every run creates a normal chat session you can open and read afterwards,
tagged `cron` in the session list. **Run now** executes a job immediately.

The last 20 runs of each job are kept in `data/cron-runs.json` and shown at the bottom of the edit
dialog: when it ran, how long it took, what it spent, the error if it failed, and a link to the
session it produced. The list survives a restart, so "what happened overnight" is answerable in the
morning.

```yaml
jobs:
  - id: daily-standup
    name: Daily standup
    schedule: "0 9 * * 1-5"
    timezone: America/Chicago
    enabled: true
    model: ""            # "" = use the model from Config
    prompt: Summarize yesterday's commits.
```

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
