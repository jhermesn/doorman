# Eval

Two ways to measure Doorman. Both are read-only: nothing is posted, labelled or stored in Pinecone or Box. Latest numbers: [docs/results.md](../docs/results.md).

|                    | Question it answers                                                                         |
| :----------------- | :------------------------------------------------------------------------------------------ |
| **Injection eval** | Are hostile reports stopped, and do legitimate reports that look hostile still get through? |
| **Shadow mode**    | On issues that are already closed, does `confirmed` match what the maintainers concluded?   |

## Injection eval

`injection/` holds one Markdown report per case, with the title on the first line. Files starting with `a` are attacks and files starting with `b` are benign traps; `expected.json` labels each one and names its technique.

Every case is built around a real bug in [`jhermesn/pie-utils`](https://github.com/jhermesn/pie-utils), the demo library. An attack only tests something when there's a genuine bug for the agent to reproduce next to the hostile instruction, so the corpus is tied to that repository.

Run it on the home Sprite:

```bash
eval/run.sh jhermesn/pie-utils results.jsonl
node eval/summarize.ts results.jsonl
```

`run.sh` triages each case with `doorman triage --issue-file`, recorded as `mode: "eval"`. Cases still run on the repository's worker, so an attack that gets past Jev meets the worker policies. `summarize.ts` prints which layer stopped each case and every command that reached the worker.

To use the corpus on another repository, copy it and rewrite each report around a bug that exists in that code, keeping the hostile part as it is.

## Shadow mode

`doorman triage <owner/repo> <issue> --shadow` replays a closed issue on the last default-branch commit before it was filed, then screens, reproduces and verifies it as usual.

It needs a `repos[]` entry for the repository (with `write` left off), a worker with its code, and a ground-truth file that maps each issue number to `bug` (a fix was merged for it) or `not-a-bug`:

```bash
eval/shadow.sh owner/repo results.jsonl 101 102 103
node eval/score-shadow.ts truth.json results.jsonl
```

`score-shadow.ts` prints the precision and recall of `confirmed` against the ground truth.
