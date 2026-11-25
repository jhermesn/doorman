# Product

Doorman does the first pass on bug reports and fix claims, so a maintainer starts from evidence instead of a description.

## What it does

- **Issues.** Screens each new issue, writes a script that shows the bug on a clean worker, runs it 3 times, then comments and labels the issue.
- **Pull requests.** When a PR says `Fixes #N`, runs the script from #N on the base commit and on the PR. The fix holds when the script fails on base and passes on the PR.
- **Memory.** Reads the maintainer's Markdown notes in Box before each job and appends a line to `log.md`.
- **Shadow mode.** Replays closed issues of a public repository read-only, to compare its verdicts with what the maintainers decided.

## Verdicts

| Verdict            | Meaning                                                            |
| :----------------- | :----------------------------------------------------------------- |
| `confirmed`        | The script failed on every run                                     |
| `cannot-reproduce` | Doorman tried, but no script failed consistently                   |
| `needs-info`       | The report has nothing runnable, or the model named what's missing |
| `duplicate`        | An earlier issue describes the same defect                         |
| `not-a-bug`        | A question, feature request, docs issue or spam                    |
| `blocked`          | The report tries to steer an automated agent, so nothing ran       |
| `oom`              | The worker ran out of memory                                       |
| `error`            | Doorman failed internally                                          |

## What it never does

- Push code, merge, close issues or approve pull requests.
- Run anything from a report that the injection screen flags.
- Write to a repository whose config doesn't say `"write": true`.
- Keep issue text in its run log; only a SHA-256 hash is stored.

## Who it is for

Maintainers of small and medium JavaScript or TypeScript projects who want a reproduction before they spend time on a report.
