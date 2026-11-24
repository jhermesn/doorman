<div align="center">

<img src="assets/logo.svg" alt="Doorman logo: an open door with a check mark in the light" width="112">

# Doorman

**No repro, no entry.**

A maintainer agent that reproduces every bug report inside a locked-down [Fly.io Sprite](https://fly.io/sprites)<br>and makes pull requests that claim a fix prove it.

[![CI](https://github.com/jhermesn/doorman/actions/workflows/ci.yml/badge.svg)](https://github.com/jhermesn/doorman/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-6d28d9.svg)](LICENSE)
[![Runs on Fly.io Sprites](https://img.shields.io/badge/runs%20on-Fly.io%20Sprites-8b5cf6.svg)](https://fly.io/sprites)
![Node 24](https://img.shields.io/badge/node-24-3c873a.svg)

</div>

---

Maintainers estimate that a quarter of incoming pull requests are low-quality AI output ([Linux Foundation, Oct 2026](https://www.linuxfoundation.org/press/new-lf-research-survey-shows-generative-ai-cuts-open-source-coding-time-in-half-but-25-of-incoming-pull-requests-are-considered-ai-slop)), and bug reports keep arriving faster than anyone can try them. Doorman does the first pass for you. It reads a new issue, restores a clean copy of your project in an isolated Sprite, writes a minimal reproduction script and runs it three times. Then it labels the issue and comments with the script and its output. When a pull request says `Fixes #123`, Doorman runs that issue's reproduction on the base branch and on the PR and sets a commit status with the result.

Everything strangers send is treated as untrusted code. It runs on a computer that can reach only package registries, holds no credentials, and is rewound to a clean checkpoint before every job.

## What it does

|     | Feature                         | How                                                                                                                                                                   |
| :-: | :------------------------------ | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 🔁  | **Reproduces issues**           | An open model on Ollama Cloud drives a shell in the worker Sprite until it has a script that fails because of the bug. The script must fail 3 out of 3 runs to count. |
| ✅  | **Checks fix claims**           | For `Fixes #N` PRs, the stored reproduction must fail on the base branch and pass on the PR. The result is a `doorman/repro` commit status.                           |
| 🛑  | **Gates every command**         | A typed safety decision from TypeSafe's Jev (about 0.25 s per call) approves each command before it runs. Jev sees the command, never the report.                     |
| 🧱  | **Contains what slips through** | Workers have deny-by-default egress, no sudo, a memory cap and no connector access. Policies are set from outside the Sprite.                                         |
| 🗂️  | **Spots duplicates**            | Every report goes into a Pinecone index; close matches are confirmed by Jev before Doorman labels a duplicate.                                                        |
| 📝  | **Learns from you**             | Its memory is Markdown in a Box folder (`env.md`, `quirks.md`, `policy.md`) that you can read and edit like a colleague's notes.                                      |
| 🔑  | **Holds no provider keys**      | GitHub, Jev, Ollama, Pinecone and Box are reached through Sprites connectors, so the keys stay in Fly.io's gateway.                                                   |

## How it works

<p align="center">
  <img src="docs/architecture.drawio.svg" alt="Architecture: a GitHub Action runs Doorman on the doorman-home Sprite, which calls GitHub, Jev, Ollama, Pinecone and Box through the Sprites connector gateway and drives a locked-down doorman-w worker Sprite that has registries-only egress, no sudo, a 2 GB memory cap and no credentials" width="900">
</p>

<sub>Edit the diagram by opening <code>docs/architecture.drawio.svg</code> in draw.io.</sub>

1. **Screen.** Jev answers three typed questions about the report: does it try to instruct an automated agent, what kind of issue is it, and is there enough to attempt a reproduction. Pinecone looks for near-duplicates.
2. **Reset.** The worker is restored to its golden checkpoint, which takes about 3 seconds.
3. **Reproduce.** The model may run commands, write files and finish. Every command goes through the gate first. The goal is `.doorman/repro.sh`, a script that exits non-zero while the bug is present.
4. **Verify.** The script runs three times. Only a consistent failure becomes `repro:confirmed`.
5. **Report.** A comment with the verdict, run results, script and output, plus a label. The script is saved to Box so later PRs can be checked against it.

## Security model

The agent and the code it runs live on different computers. Doorman's process sits on `doorman-home`; anything a bug report causes to run happens on a `doorman-w-*` worker.

| Layer                     | What it stops                                                         | Where it lives                                      |
| :------------------------ | :-------------------------------------------------------------------- | :-------------------------------------------------- |
| Prompt boundary           | Report text is wrapped as data and the model is told not to follow it | `src/agent/reproduce.ts`                            |
| Read-only notes           | A report rewriting the maintainer's notes in Box                      | `src/box.ts` refuses to write them                  |
| Injection screen          | Reports aimed at automated agents are not run at all                  | Jev, before any command                             |
| Command gate              | `curl \| sh`, raw sockets, credential reads, persistence, miners      | Jev, on the command alone                           |
| Worker egress             | Any host except package registries and GitHub                         | Sprite network policy                               |
| Worker privileges         | `sudo`, privilege escalation                                          | Sprite privileges policy                            |
| Worker resources          | Memory exhaustion (the worker reboots, the job ends as `oom`)         | Sprite resources policy                             |
| No keys on workers        | Exfiltrating credentials                                              | Connector access policies match `doorman-home` only |
| Scoped orchestrator token | Touching anything but workers                                         | Sprites token restricted to the `doorman-w-` prefix |
| GitHub allowlist          | Writing to repositories Doorman isn't configured for                  | Connector endpoint list plus a client-side guard    |

Each layer was tested on a real Sprite. The commands and results are in [docs/spikes.md](docs/spikes.md).

## Quickstart

You need a Fly.io account with Sprites, the `sprite` CLI, Node 24, and accounts for TypeSafe, Ollama Cloud, Pinecone and Box.

1. **Connectors.** In the Fly.io dashboard, add the GitHub, Box, TypeSafeAI, Ollama and Pinecone connectors. Give each an access policy with name prefix `doorman-home`. For GitHub, also restrict endpoints to your repositories (see [docs/security.md](docs/security.md)).
2. **Pinecone index.** Create an index named `doorman-issues` with integrated embedding (`llama-text-embed-v2`). The connector forwards data operations only, so this step runs once from your machine.
3. **Worker.** Bootstrap a worker for each repository:

   ```bash
   scripts/bootstrap-worker.sh <org> doorman-w-<name> <owner/repo> "npm ci --ignore-scripts"
   ```

   It creates the Sprite, applies the policies in [`policies/worker/`](policies/worker), clones the repository, runs the prepare command and takes the golden checkpoint.
4. **Home.** Create a Sprites token restricted to the `doorman-w-` prefix in the dashboard, then run:

   ```bash
   scripts/bootstrap-home.sh <org> doorman-home
   ```

   It installs Doorman from GitHub, asks for the token (stored with mode `0600`) and applies [`policies/home/network.json`](policies/home/network.json).
5. **Configure.** Fill in [`doorman.config.example.json`](doorman.config.example.json) with your connector IDs and push it:

   ```bash
   sprite file push -s doorman-home doorman.config.json /home/sprite/.config/doorman/config.json
   ```

6. **Run.**

   ```bash
   sprite exec -s doorman-home -- doorman triage owner/repo 42 --dry-run
   sprite exec -s doorman-home -- doorman check-pr owner/repo 57
   ```

7. **Automate.** In the Fly.io dashboard, create a Sprites token restricted to the single Sprite `doorman-home` (or, where your organization can't scope tokens to one Sprite, to the name prefix `doorman-home`), store it as the `DOORMAN_SPRITES_TOKEN` secret, and add this workflow:

   ```yaml
   name: Doorman
   on:
     issues:
       types: [opened]
     pull_request_target:
       types: [opened, synchronize]
   permissions: {}
   jobs:
     doorman:
       runs-on: ubuntu-latest
       steps:
         - uses: jhermesn/doorman@<commit-sha>
           with:
             org: <fly-org>
             sprites-token: ${{ secrets.DOORMAN_SPRITES_TOKEN }}
   ```

   The job checks out nothing and needs no GitHub permissions: Doorman reaches GitHub through its connector.

## Limitations

- Reproduction works best on JavaScript and TypeScript projects whose bugs can be shown with a script. UI, timing and hardware bugs usually end as `cannot-reproduce`.
- Doorman fetches public repositories only.
- A confirmed reproduction is evidence, not a fix. Doorman never pushes code.
- Free Fly.io accounts allow three Sprites, which means one home and two workers.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup and checks; [AGENTS.md](AGENTS.md) is the map of the codebase for people and coding agents alike. Report vulnerabilities privately as described in [SECURITY.md](SECURITY.md).

## License

[Apache-2.0](LICENSE). The logo and the diagram use [Lucide](https://lucide.dev) icons ([ISC](assets/LICENSE-lucide.txt)) and brand icons from [Simple Icons](https://simpleicons.org) (CC0); brand names and logos belong to their owners. Doorman is an independent project and is not affiliated with Fly.io, TypeSafe AI, Ollama, Pinecone or Box.
