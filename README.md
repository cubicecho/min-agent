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
| Cron run summary | Each run's history entry says what it found | You open the session to find out |

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

### Cron run summaries

A cron job's problem is that nobody watched it. The run log can tell you a job finished in 19
seconds for 4.1k tokens without telling you whether it found anything, so the only way to know is
to open the session — for every run, every morning.

Set a model for **Cron run summary** and each successful run gets one sentence, written from the
job's instruction and its final answer, and stored on the run record:

    ✓ today 03:30 · 18.7s · 4.1k tokens
      The job found 7 top-level entries in the root of the NAS.

The newest one also sits on the job's row in the Cron list, which is usually as far as you need to
read. Failed runs get their error instead — a summary of a failure is just the error, longer.

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
