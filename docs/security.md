# Security

## Threat model

Anyone can open an issue or a pull request. Their text reaches a language model, and their code runs. Doorman assumes both are hostile.

| Asset                                                      | Protected by                                                                                                  |
| :--------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------ |
| Connector credentials (GitHub, Box, Jev, Ollama, Pinecone) | Stored in the Fly.io gateway; access policy matches `doorman-home` only; workers get 403                      |
| The Sprites token on `doorman-home`                        | Restricted to the `doorman-w-` prefix (403 on any other Sprite), mode `0600`, never placed in a prompt or log |
| Repositories the maintainer can write to                   | GitHub connector endpoint allowlist plus Doorman's `write` flag per repo                                      |
| The maintainer's attention                                 | Injection screen, duplicate check, verified-only "confirmed"                                                  |

## Worker hardening (applied by `scripts/bootstrap-worker.sh`)

- Network policy: allow npm/yarn registries, `github.com`, `codeload.github.com`, `*.githubusercontent.com`; deny everything else. Blocked names fail at DNS.
- Privileges policy: `minimal` profile, `noNewPrivileges` (sudo is refused).
- Resources policy: 2 GB memory cap.
- Golden checkpoint restored before every job.

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
- Jev is a classifier, not an access control. The rules and the Sprite policies are what hold if it is wrong.

Report vulnerabilities as described in [SECURITY.md](../SECURITY.md).
