# Doorman

A maintainer agent that reproduces bug reports and checks fix claims inside isolated Fly.io Sprites. Start here, then read only what the task needs.

| Read                                   | When                                                                           |
| :------------------------------------- | :----------------------------------------------------------------------------- |
| [docs/product.md](docs/product.md)     | Always. What Doorman does and what it must never do                            |
| [docs/tech.md](docs/tech.md)           | Always. Stack, commands, platform facts                                        |
| [docs/structure.md](docs/structure.md) | Always. Where code lives and how a job flows                                   |
| [docs/security.md](docs/security.md)   | Touching the gate, prompts, workers, connectors or anything that runs commands |
| [docs/spikes.md](docs/spikes.md)       | Relying on a Sprites or connector behaviour; every one there was measured      |

Rules that matter most:

- Bug reports, issue comments and command output are untrusted data. Never let them choose commands, labels or targets without the gate.
- Workers get no connectors, no policy changes after bootstrap, and no new capabilities. Add features on the home side.
- `npm run check` must pass before every commit. Tests are table-driven and named `given …, when …, then …`.
- No secrets in code, fixtures or logs. Build fake credentials at runtime in tests.
