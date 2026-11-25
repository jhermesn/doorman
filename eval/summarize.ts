// Turns eval/run.sh output into a Markdown table: which layer stopped each case.
// Usage: node eval/summarize.ts <results.jsonl>
import { readFileSync } from "node:fs";
import { z } from "zod";

const Expected = z.record(
  z.string(),
  z.object({ kind: z.enum(["attack", "benign"]), technique: z.string() }),
);
const Result = z.object({
  case: z.string(),
  verdict: z.string(),
  screen: z.object({ injectionP: z.number() }).optional(),
  steps: z
    .array(z.object({ cmd: z.string(), gate: z.object({ decision: z.string() }).optional() }))
    .default([]),
});
type Result = z.infer<typeof Result>;

const NOT_RUN = new Set(["blocked", "not-a-bug", "needs-info", "duplicate"]);

function stoppedBy(r: Result): string {
  if (r.verdict === "blocked") return "Jev screen";
  if (r.steps.some((s) => s.gate?.decision === "block")) return "Jev gate";
  if (NOT_RUN.has(r.verdict)) return `screen: ${r.verdict}`;
  return "worker (see commands)";
}

function parseLines(path: string): Result[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => {
      const parsed = Result.safeParse(JSON.parse(line.startsWith("{") ? line : "null"));
      return parsed.success ? [parsed.data] : [];
    });
}

const expected = Expected.parse(
  JSON.parse(readFileSync(new URL("expected.json", import.meta.url), "utf8")),
);
const results = parseLines(process.argv[2] ?? "eval-results.jsonl");
console.log("| Case | Kind | Technique | Verdict | Injection p | Gate blocks | Stopped by |");
console.log("| :-- | :-- | :-- | :-- | --: | --: | :-- |");
for (const r of results) {
  const e = expected[r.case];
  const blocks = r.steps.filter((s) => s.gate?.decision === "block").length;
  const p = r.screen?.injectionP.toFixed(2) ?? "";
  const by =
    e?.kind === "benign"
      ? blocks || r.verdict === "blocked"
        ? "⚠️ false positive"
        : "passed through"
      : stoppedBy(r);
  console.log(
    `| ${r.case} | ${e?.kind ?? "?"} | ${e?.technique ?? ""} | ${r.verdict} | ${p} | ${blocks} | ${by} |`,
  );
}
console.log("\n## Commands run on the worker\n");
for (const r of results.filter((x) => x.steps.length)) {
  console.log(`### ${r.case}\n`);
  for (const s of r.steps)
    console.log(
      `- \`${s.cmd.slice(0, 160).replaceAll("`", "'")}\` → ${s.gate?.decision ?? "ungated"}`,
    );
  console.log();
}
