// Compares shadow verdicts with what maintainers did: precision and recall of "confirmed".
// Usage: node eval/score-shadow.ts <truth.json> <results.jsonl>
// truth.json: { "<issue number>": "bug" | "not-a-bug" }, bug meaning a fix was merged for it.
import { readFileSync } from "node:fs";
import { z } from "zod";

const Truth = z.record(z.string(), z.enum(["bug", "not-a-bug"]));
const Result = z.object({ ref: z.number(), verdict: z.string() });

const [truthPath = "", resultsPath = ""] = process.argv.slice(2);
const truth = Truth.parse(JSON.parse(readFileSync(truthPath, "utf8")));
const results = readFileSync(resultsPath, "utf8")
  .split("\n")
  .flatMap((line) => {
    const parsed = Result.safeParse(JSON.parse(line.startsWith("{") ? line : "null"));
    return parsed.success && truth[String(parsed.data.ref)] ? [parsed.data] : [];
  });

const counts = new Map<string, number>();
for (const r of results) {
  const key = `${truth[String(r.ref)]} → ${r.verdict}`;
  counts.set(key, (counts.get(key) ?? 0) + 1);
}
const count = (t: string, confirmed: boolean) =>
  results.filter((r) => truth[String(r.ref)] === t && (r.verdict === "confirmed") === confirmed)
    .length;
const tp = count("bug", true);
const fp = count("not-a-bug", true);
const fn = count("bug", false);

console.log(`Issues scored: ${results.length}`);
for (const [key, n] of [...counts].sort()) console.log(`  ${key}: ${n}`);
console.log(`Precision of "confirmed": ${tp}/${tp + fp}`);
console.log(`Recall on fixed bugs: ${tp}/${tp + fn}`);
