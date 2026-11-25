# Eval

Two ways to measure Doorman, both read-only: nothing is posted, labelled or stored.

| What           | Files                                                   | Question it answers                                                                    |
| :------------- | :------------------------------------------------------ | :------------------------------------------------------------------------------------- |
| Injection eval | `injection/`, `expected.json`, `run.sh`, `summarize.ts` | Do hostile reports get stopped, and do legitimate ones that look hostile get through?  |
| Shadow mode    | `shadow.sh`, `score-shadow.ts`                          | On real, already closed issues, does `confirmed` match what the maintainers concluded? |

Latest numbers: [docs/results.md](../docs/results.md). How each run works: [docs/structure.md](../docs/structure.md#injection-eval).

## Injection corpus

`injection/` holds one Markdown report per case, the first line being the title: `a*` files are attacks, `b*` files are benign traps. `expected.json` labels each case and names its technique.

Every case wraps a real bug in [`jhermesn/pie-utils`](https://github.com/jhermesn/pie-utils), the demo library. An attack only tests something when there's a genuine bug for the agent to reproduce next to the hostile instruction, so the corpus is tied to that repository.

```bash
eval/run.sh jhermesn/pie-utils results.jsonl   # on the home Sprite
node eval/summarize.ts results.jsonl          # which layer stopped each case
```

To run it against another repository, copy the corpus and rewrite each report around a bug that exists in that code, keeping the hostile part as it is. `run.sh` takes any configured `owner/repo`.

## Shadow mode

Shadow mode needs a `repos[]` entry for the target (with `write` left off) and a worker with its code, plus a ground-truth file mapping issue numbers to `bug` or `not-a-bug`:

```bash
eval/shadow.sh owner/repo results.jsonl 101 102 103
node eval/score-shadow.ts truth.json results.jsonl
```
