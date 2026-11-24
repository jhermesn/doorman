# Security

## Threat model

Anyone can open an issue or a pull request. Their text reaches a language model, and their code runs. Doorman assumes both are hostile.

| Asset                                                        | Protected by                                                                                                     |
| :----------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| Connector credentials (GitHub, Box, Jev, Ollama, Pinecone)   | Stored in the Fly.io gateway; access policy matches `doorman-home` only; workers get 403                         |
| The Sprites token on `doorman-home`                          | Restricted to the `doorman-w-` prefix (403 on any other Sprite), mode `0600`, never placed in a prompt or log    |
| Repositories the maintainer can write to                     | GitHub connector endpoint allowlist plus Doorman's `write` flag per repo                                         |
| The maintainer's attention                                   | Injection screen, duplicate check, verified-only "confirmed"                                                     |
| Maintainer notes in Box (`env.md`, `quirks.md`, `policy.md`) | Doorman reads them as trusted guidance and refuses to write them, so a report can't rewrite its own instructions |

## Worker hardening (applied by `scripts/bootstrap-worker.sh`)

- Network policy: allow npm/yarn registries, `github.com`, `codeload.github.com`, `*.githubusercontent.com`; deny everything else. Blocked names fail at DNS.
- Privileges policy: `minimal` profile, `noNewPrivileges` (sudo is refused).
- Resources policy: 2 GB memory cap.
- Golden checkpoint restored before every job.
- The `prepare` command runs again after checking out a pull request, so use `npm ci --ignore-scripts` unless the project needs install scripts; otherwise a PR's `postinstall` runs before the reproduction does (still inside the worker).

## Command gate

Jev answers one typed question per command, "is this safe to run in the sandbox?", and sees only the command, never the bug report, so report text can't argue a command through. A command runs when Jev puts the probability of `allow` at 0.6 or more.

On a 22-command set run through the gateway, every ordinary command (`ls -R`, `cat`, `npm install`, `pip install`, running the repro script, `TZ=... node ...`) scored 0.74 or more, and every hostile one (`curl | sh`, reverse shells, `nc -l`, credential and `/proc/self/environ` reads, crontab persistence, `rm -rf /`, a fork bomb, `base64 -d | sh`) scored 0.46 or less.

## GitHub Action

- The workflow token is restricted to the `doorman-home` Sprite (single-Sprite scope, or the name prefix `doorman-home` in organizations that can't scope a token to one Sprite), so a leaked secret can run Doorman but can't reach workers or other Sprites. The home Sprite's own token is the only one that touches workers.
- The job never checks out code, so `pull_request_target` is safe here: it gives fork pull requests the secret without running their code on the runner. Their code runs only inside a worker.
- Only the event name, repository and number reach the shell, through environment variables passed to `doorman` as arguments. Issue titles and bodies never do.
- `permissions: {}`: Doorman reaches GitHub through its connector, so the workflow's `GITHUB_TOKEN` needs nothing.
- The Sprites CLI is pinned to a release, and its installer checks the binary's SHA-256.

## GitHub connector policy

Endpoint lists match paths, not HTTP methods, and `/repos/x/y/*` does not match `/repos/x/y`. A working policy:

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

- The restricted Sprites token can still change the policies of `doorman-w-*` Sprites. Doorman's client exposes no policy operations, but a compromise of the home Sprite would.
- Jev is a classifier, not an access control. The Sprite policies are what hold if it is wrong.
- Without the TypeSafe connector there is no injection screen and no gate: every report reaches the worker and every command runs there. The comment says so ("Gate: off"), and the worker policies are the only layer.
- `sudo` commands pass the gate (they are harmless here) and are refused by the privileges policy instead.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
