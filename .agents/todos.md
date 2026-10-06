# Project Todos

Findings from the refactor workflow. IDs are stable — don't renumber when items are removed.
`(unverified)` marks items inferred from docs or naming rather than confirmed in code.
Nothing here is implemented until approved.

Survey of 2026-10-05 read `server/agent.ts`, `mobile/app/_layout.tsx`, `mobile/app/settings.tsx`,
`mobile/app/embed/[id].tsx` and `mobile/components/chat/{chat-view,message-view,session-list}.tsx`.
Sweep counts are pattern matches over all app-owned code and are approximate. R1–R14 and D1 are done.

## Conventions

- Vendored cubeui files (`mobile/components/*.tsx`, `mobile/components/ui/`) are not edited to comply.
- Formatting and lint: `npm run format` before every commit (see `AGENTS.md`).
- Generated: `shared/gql/graphql.ts` → `npm run codegen`.

## Refactoring

### R17 [sweep] — type assertions in the tests

**Hits:** about 90 under `tests/`, most of them a fixture named as its type (`] as StoredMessage[]`,
`as unknown as Session`). R13 swept the source only. An annotation or `satisfies` covers most; the
ones that build a deliberately partial object need a builder.

---

## Bugs

### B1 — the two "latest" lookups skip different rows

**File:** `server/agent.ts`, `latestPromptTokens` and `latestContextTokens`. The first stops at
the first message with stats and answers zero if it has no prompt count; the second walks past
stats that lack a context count. Is this intended?

### B2 — a thrown value that is not an `Error` is reported as `undefined`

**Files:** `server/voice.ts`, `server/wyoming.ts`, `server/db/client.ts`, `server/agent.ts`
(`failedRun`), `scripts/codegen-watch.ts`, `mobile/lib/voice.ts`, `mobile/components/chat/chat-view.tsx`,
`mobile/components/settings/mcp-panel.tsx`. Each reads `(error as Error).message` in a `catch`. Four
settings panels already have `messageOf`, which checks with `instanceof` and falls back to
`String(error)`. Should these eight do the same?

### B3 — bodies and parsed JSON are named as a shape without being checked

**Files:** `server/voice.ts` (`request.body` on `/transcribe` and `/speak`), `server/wyoming.ts`
(an event's header), `shared/tool-proxy.ts` and `server/agent.ts` (a tool call's arguments),
`mobile/lib/voice-settings.ts` (the stored settings), `shared/client/gql.ts` and
`shared/client/voice.ts` (a response body). A value of the wrong type goes through as the declared
one. Which of these should be parsed with a schema?

### B4 — `typing` treats any event target as an element

**File:** `mobile/lib/keys.ts`. `target as HTMLElement | null` reads `tagName` from whatever the
event was aimed at, which can be the document or the window. It answers `false` for those today
only because the properties are missing. Intended?

---

## API changes (need a decision)

### A1 — `sendTurn` and `SendOptions` have no production caller

Exported from `server/agent.ts` and used only by two test files, so those tests pin a path the
server no longer runs. Options: keep as a test-only export, or move the tests onto `runTurn` and
remove it.

---

## Low value

### R15 [readability] — split `chat-view.tsx` (905 lines)

A turn controller hook, a composer, and the token readouts in their own module. Three changes
in 3 months.

### R16 [consistency] — import paths with and without a file extension

55 with, 29 without, among app-owned modules.
