# Security

Anyone can open an issue or a pull request: their text reaches a language model, and their code runs. Doorman assumes both are hostile. To contain them, the agent and the code it runs live on different Sprites. Doorman runs on `doorman-home`, and anything a report causes to run happens on a `doorman-w-*` worker.

## Layers

| Layer              | What it stops                                                | Enforced by                                                 |
| :----------------- | :----------------------------------------------------------- | :---------------------------------------------------------- |
| Prompt boundary    | The model following instructions in the report               | The prompt marks report text as data                        |
| Injection screen   | Reports aimed at automated agents; they never run            | Jev, before any command                                     |
| Command gate       | `curl \| sh`, sockets, credential reads, persistence, miners | Jev, judging the command alone                              |
| Worker egress      | Every host except package registries and GitHub              | Sprite network policy                                       |
| Worker privileges  | `sudo` and privilege escalation                              | Sprite privileges policy                                    |
| Worker memory      | Exhausting memory; the job ends as `oom`                     | Sprite resources policy                                     |
| No keys on workers | Stealing credentials                                         | Connector policies match `doorman-home` only                |
| Scoped home token  | Reaching anything but workers                                | Sprites token limited to `doorman-w-`                       |
| GitHub allowlist   | Writing to repositories Doorman isn't set up for             | Connector endpoint list and Doorman's `write` flag          |
| Read-only notes    | A report rewriting the maintainer's notes                    | Doorman refuses to write `env.md`, `quirks.md`, `policy.md` |

Each layer was tested on a real Sprite. The commands and results are in [platform.md](platform.md), and the injection eval results in [results.md](results.md).

## What an attacker can't reach

- **Provider keys** (GitHub, Box, Jev, Ollama, Pinecone) stay in the Fly.io gateway. Workers get a 403.
- **The home Sprite's token** only works on `doorman-w-*` Sprites. It's stored with mode `0600` and never goes into a prompt or a log.
- **Other repositories:** the GitHub connector only allows the configured repositories, and Doorman only writes where `write` is on.

## Workers

`scripts/bootstrap-worker.sh` applies:

- a network policy that allows npm and yarn registries, `github.com`, `codeload.github.com` and `*.githubusercontent.com`, and denies the rest (blocked names fail at DNS);
- the `minimal` privileges profile with `noNewPrivileges`, so `sudo` is refused;
- a 2 GB memory cap;
- a golden checkpoint, restored before every job.

The `prepare` command runs again after checking out a pull request. Use `npm ci --ignore-scripts` unless the project needs install scripts; otherwise a PR's `postinstall` runs before the reproduction does, though still inside the worker.

## Command gate

Jev answers one question per command, "is this safe to run in the sandbox?", and sees only the command, never the report, so the report can't argue a command through. A command runs when Jev's probability of `allow` is 0.6 or more.

On a set of 22 commands, every ordinary one (`ls -R`, `cat`, `npm install`, running the repro script, `TZ=... node ...`) scored 0.74 or more. Every hostile one (`curl | sh`, reverse shells, `nc -l`, reading credentials or `/proc/self/environ`, crontab persistence, `rm -rf /`, a fork bomb, `base64 -d | sh`) scored 0.46 or less.

## GitHub Action

- The workflow's Sprites token is limited to `doorman-home` (one Sprite, or the name prefix where the organization can't scope a token to one Sprite). A leaked secret can run Doorman, but can't reach workers.
- The job never checks out code, which makes `pull_request_target` safe here: fork PRs get the secret without their code running on the runner. Their code runs only on a worker.
- Only the event name, repository and number reach the shell, as environment variables. Issue titles and bodies never do.
- `permissions: {}`, because Doorman reaches GitHub through its connector.
- The Sprites CLI is pinned to a release, and its installer checks the binary's SHA-256.

## GitHub connector policy

Endpoint lists match paths, not HTTP methods, and `/repos/x/y/*` doesn't match `/repos/x/y`. A working policy:

```json
{
  "name_prefix": "doorman-home",
  "allowed_endpoints": ["/repos/<owner>/<repo>", "/repos/<owner>/<repo>/*", "/rate_limit"],
  "blocked_endpoints": [
    "/repos/<owner>/<repo>/hooks*",
    "/repos/<owner>/<repo>/collaborators*",
    "/repos/<owner>/<repo>/keys*",
    "/repos/<owner>/<repo>/actions/*",
    "/repos/<owner>/<repo>/git/*",
    "/repos/<owner>/<repo>/contents/*"
  ]
}
```

## Known gaps

- The home token can still change the policies of `doorman-w-*` Sprites. Doorman's code never calls those routes, but a compromised home Sprite could.
- Jev is a classifier, not an access control. If it's wrong, the Sprite policies are what hold.
- Jev also compares a PR's base output with the confirmed run's. That answer can only hold back a verdict; whether a fix passes is always decided by the script's exit codes.
- Restoring a saved failing state ends any job running on that worker at the time.
- Without the TypeSafe connector there's no screen and no gate, and the worker policies are the only layer. The comment then says "Gate: off".
- `sudo` commands pass the gate because they're harmless here; the privileges policy refuses them.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
