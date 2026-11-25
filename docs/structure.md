# Structure

```
src/
  cli.ts            entry point: `doorman triage` and `doorman check-pr`
  config.ts         config schema and validation (no secrets in config)
  text.json         every prompt, Jev question and comment string, with {placeholders}
  text.ts           loads text.json; fill() replaces placeholders in one pass
  clients.ts        builds every SDK client against its Sprites connector URL
  github.ts         Octokit with a write guard for repos not marked `write`
  box.ts            Box SDK memory; maintainer notes are read-only
  workers.ts        the only way to touch a worker Sprite (prefix-checked)
  runlog.ts         one JSON line per job
  agent/
    screen.ts       Jev questions + Pinecone duplicate lookup
    gate.ts         Jev safety check before every command
    reproduce.ts    AI SDK tool loop (run, write_file, finish)
    verify.ts       runs the reproduction N times and classifies the result
    verdict.ts      early and final verdicts, labels
    report.ts       the GitHub comment
    triage.ts       issue flow: screen → reset → reproduce → verify → report → remember
    prcheck.ts      PR flow: base vs head with the stored reproduction
scripts/            bootstrap-worker.sh, bootstrap-home.sh (run from a maintainer machine)
policies/           Sprite network, privileges and memory policies the scripts apply
eval/               injection corpus (12 attacks, 5 benign traps), shadow-mode runner, scorers (see eval/README.md)
test/               Vitest, one file per behaviour
```

## How an issue job flows

1. `cli.ts` loads the config, `createDeps` builds the clients, fetches the issue (or reads `--issue-file`) and calls `triageIssue`.
2. `screen` may end the job early (`blocked`, `duplicate`, `not-a-bug`, `needs-info`).
3. `prepareWorker` restores the golden checkpoint and runs the repo's trusted `prepare` command.
4. `reproduce` loops: model → tool call → `gate` → `workers.run` → output back to the model.
5. `verify` runs `.doorman/repro.sh` three times; `finalVerdict` trusts the script, not the model.
6. The report is posted, the label added, the script saved to Box, the issue upserted to Pinecone, and one JSON event for the run written to stderr.

## Injection eval

`eval/injection/` holds one Markdown report per case; `eval/expected.json` says whether each is an attack or a benign trap. On the home Sprite, `eval/run.sh <owner/repo> results.jsonl` triages every case with `--issue-file`, which posts nothing, skips Pinecone and Box writes, and records `mode: "eval"`. Each case still runs on the repo's worker, so attacks that pass Jev meet the worker policies. `node eval/summarize.ts results.jsonl` prints which layer stopped each case and every command that reached the worker.

## Shadow mode

`doorman triage <owner/repo> <issue> --shadow` replays a closed issue without writing anything: it checks out the last default-branch commit before the issue was filed, then runs the usual screen, reproduce and verify steps. `eval/shadow.sh <owner/repo> results.jsonl <issue>...` runs a list of issues on the home Sprite. `node eval/score-shadow.ts truth.json results.jsonl` compares the verdicts with a ground-truth file mapping each issue number to `bug` (a fix was merged for it) or `not-a-bug`, and prints the precision and recall of `confirmed`. The repo needs a `repos[]` entry (with `write` left off) and a worker with its code.
