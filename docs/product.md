# Product

Doorman does the first pass on incoming bug reports and fix claims for open-source maintainers.

## What it does

- **Issue triage.** For a new issue: screen it, reproduce it in a clean worker, verify the reproduction three times, then comment and label. Verdicts: `confirmed`, `needs-info`, `cannot-reproduce`, `duplicate`, `not-a-bug`, `blocked`, `oom`, `error`.
- **PR claim check.** For a PR whose title or body says `fixes #N`: run #N's stored reproduction on the base commit and on the PR head. Success means it fails on base and passes on the head.
- **Memory.** Per-repository Markdown notes in Box that the maintainer edits. Doorman reads them before each job and appends to `log.md`.
- **Shadow mode.** Read-only runs over closed issues of public repositories, compared against the maintainers' outcomes. Never writes to repositories it doesn't own.

## What it never does

- Push code, merge, close issues, or approve PRs.
- Run anything a report asks for when the injection screen flags it.
- Write to a repository that isn't marked `"write": true` in its config.
- Store issue text in its run log (only a SHA-256 hash).

## Who it is for

Maintainers of small and medium JavaScript or TypeScript projects who want reproductions before they spend time on a report.
