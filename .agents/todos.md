# Project Todos

Findings from the refactor workflow. IDs are stable — don't renumber when items are removed.
`(unverified)` marks items inferred from docs or naming rather than confirmed in code.
Nothing here is implemented until approved.

Survey of 2026-10-05 read `server/agent.ts`, `mobile/app/_layout.tsx`, `mobile/app/settings.tsx`,
`mobile/app/embed/[id].tsx` and `mobile/components/chat/{chat-view,message-view,session-list}.tsx`.
Sweep counts are pattern matches over all app-owned code and are approximate. R1–R8 and D1 are done.

## Conventions

- Vendored cubeui files (`mobile/components/*.tsx`, `mobile/components/ui/`) are not edited to comply.
- Formatting and lint: `npm run format` before every commit (see `AGENTS.md`).
- Generated: `shared/gql/graphql.ts` → `npm run codegen`.

## Refactoring

### R9 [sweep] — braces on every `if` (P15)

**Hits:** about 222; `mobile/lib/voice.ts` 31, `server/agent.ts` 30, `chat-view.tsx` 21.

### R10 [sweep] — `=== false` for logic negation (P20)

**Hits:** up to 110 `!x` sites; null guards not yet separated out.

### R11 [sweep] — named values in a `defaults` module (P16)

**Hits:** `server/agent.ts` (2000, 6000, 200, 0.9), `chat-view.tsx` (100, 4, 250, 0.9, 0.75).

### R12 [sweep] — lookup tables instead of nested ternaries

**Hits:** about 7, among them `when` in `session-list.tsx` and `ContextMeter` in `chat-view.tsx`.

### R13 [sweep] — type assertions

**Hits:** about 61; 19 in `shared/client/api.ts` (unread).

### R14 [sweep] — tests in the same folders as the source (P21)

**Hits:** 34 test files flat under `tests/`.

---

## Bugs

### B1 — the two "latest" lookups skip different rows

**File:** `server/agent.ts`, `latestPromptTokens` and `latestContextTokens`. The first stops at
the first message with stats and answers zero if it has no prompt count; the second walks past
stats that lack a context count. Is this intended?

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
