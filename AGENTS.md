# Agent notes

## Git

**Always merge, never rebase.** When a push is rejected because `origin/main` has moved,
`git merge` it — do not `git rebase`, and do not force-push. Rebasing rewrites commits that
have already been published, which changes their hashes out from under anything referring to
them, and a merge commit recording that the histories diverged is the accurate account of what
happened.

This applies however trivial the incoming change looks. A `chore(release)` bump from CI touching
only `package.json` is exactly the case where rebasing feels safe enough to skip asking, and it
is still a rewrite of shipped history.

## Formatting

**Run `npm run format` before every commit.** Biome is the formatter as well as the linter, and
CI runs `npm run lint` — `biome check .`, which fails on formatting the same way it fails on a
lint rule. A line a few characters over the width limit is enough to turn the whole run red.

Checking only the files you edited is not enough either: a formatting change can come in with a
generated file or a merge. `npm run format` is `biome check --write .` over the repo, so run it
whole and commit whatever it touches.
