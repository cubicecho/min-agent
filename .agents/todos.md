# Project Todos

Findings from the refactor workflow. IDs are stable — don't renumber when items are removed.
`(unverified)` marks items inferred from docs or naming rather than confirmed in code.
Nothing here is implemented until approved.

Survey of 2026-10-05 read `server/agent.ts`, `mobile/app/_layout.tsx`, `mobile/app/settings.tsx`,
`mobile/app/embed/[id].tsx` and `mobile/components/chat/{chat-view,message-view,session-list}.tsx`.
Sweep counts are pattern matches over all app-owned code and are approximate. R1–R14, R17, D1 and B2–B4 are done.

## Conventions

- Vendored cubeui files (`mobile/components/*.tsx`, `mobile/components/ui/`) are not edited to comply.
- Formatting and lint: `npm run format` before every commit (see `AGENTS.md`).
- Generated: `shared/gql/graphql.ts` → `npm run codegen`.

## Refactoring

### R18 [duplication] — six copies of "the message of whatever was thrown"

`messageOf` is defined locally in `mobile/components/settings/{apps-panel,model-panel,mcp-panel}.tsx`
and `mobile/components/apps/config-form.tsx`, and written inline in `device-panel.tsx` and
`server-panel.tsx`. `shared/errors.ts` now exports the same function (added for B2), and
`server/` reads agent-core's `errorMessage` in three places. One import each.

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
