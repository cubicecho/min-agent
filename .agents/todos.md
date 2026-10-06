# Project Todos

Findings from the refactor workflow. IDs are stable — don't renumber when items are removed.
`(unverified)` marks items inferred from docs or naming rather than confirmed in code.
Nothing here is implemented until approved.

Survey of 2026-10-05 read `server/agent.ts`, `mobile/app/_layout.tsx`, `mobile/app/settings.tsx`,
`mobile/app/embed/[id].tsx` and `mobile/components/chat/{chat-view,message-view,session-list}.tsx`.
Sweep counts are pattern matches over all app-owned code and are approximate. R1–R18, A1, D1 and B2–B4 are done.

## Conventions

- Vendored cubeui files (`mobile/components/*.tsx`, `mobile/components/ui/`) are not edited to comply.
- Formatting and lint: `npm run format` before every commit (see `AGENTS.md`).
- Generated: `shared/gql/graphql.ts` → `npm run codegen`.
- Imports name the file they read, extension included. The exception is a mobile module with a
  `.web.tsx` sibling: its path stays bare, which is what lets Metro pick the platform file.

## Bugs

### B1 — the two "latest" lookups skip different rows

**File:** `server/agent.ts`, `latestPromptTokens` and `latestContextTokens`. The first stops at
the first message with stats and answers zero if it has no prompt count; the second walks past
stats that lack a context count. Is this intended?
