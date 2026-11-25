# Setup

You need a Fly.io account with Sprites, the `sprite` CLI, Node 24 and an Ollama Cloud account. GitHub and Ollama are the only required connectors; each optional one adds a feature and Doorman runs without it:

| Connector | Required | Without it                                                                               |
| :-------- | :------: | :--------------------------------------------------------------------------------------- |
| GitHub    |    ✅    | Nothing to read or report to                                                             |
| Ollama    |    ✅    | No model to drive the reproduction                                                       |
| TypeSafe  |          | No injection screen and no command gate; the worker policies still contain every command |
| Pinecone  |          | No duplicate detection                                                                   |
| Box       |          | No maintainer notes; PR checks read the reproduction from Doorman's issue comment        |

1. **Connectors.** In the Fly.io dashboard, add the GitHub and Ollama connectors, plus whichever optional ones you want. Give each an access policy with name prefix `doorman-home`. For GitHub, also restrict endpoints to your repositories (see [security.md](security.md)).
2. **Pinecone index** (optional). Create an index named `doorman-issues` with integrated embedding (`llama-text-embed-v2`). The connector forwards data operations only, so this step runs once from your machine.
3. **Worker.** Bootstrap a worker for each repository:

   ```bash
   scripts/bootstrap-worker.sh <org> doorman-w-<name> <owner/repo> "npm ci --ignore-scripts"
   ```

   It creates the Sprite, applies the policies in [`policies/worker/`](../policies/worker), clones the repository, runs the prepare command and takes the golden checkpoint.
4. **Home.** Create a Sprites token restricted to the `doorman-w-` prefix in the dashboard, then run:

   ```bash
   scripts/bootstrap-home.sh <org> doorman-home
   ```

   It installs Doorman from GitHub, asks for the token (stored with mode `0600`) and applies [`policies/home/network.json`](../policies/home/network.json).
5. **Configure.** Fill in [`doorman.config.example.json`](../doorman.config.example.json) with your connector IDs and push it:

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
         - uses: jhermesn/doorman@v0.3.0
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
