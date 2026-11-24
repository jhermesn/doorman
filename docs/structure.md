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
test/               Vitest, one file per behaviour
```

## How an issue job flows

1. `cli.ts` loads the config, `createDeps` builds the clients, and it calls `triageIssue`.
2. `screen` may end the job early (`blocked`, `duplicate`, `not-a-bug`, `needs-info`).
3. `prepareWorker` restores the golden checkpoint and runs the repo's trusted `prepare` command.
4. `reproduce` loops: model → tool call → `gate` → `workers.run` → output back to the model.
5. `verify` runs `.doorman/repro.sh` three times; `finalVerdict` trusts the script, not the model.
6. The report is posted, the label added, the script saved to Box, the issue upserted to Pinecone, and the run appended to `runs.jsonl`.
