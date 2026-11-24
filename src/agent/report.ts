import type { Verdict } from "../runlog.js";
import { fill, text } from "../text.js";
import type { Verification } from "./verify.js";

export interface ReportInput {
  verdict: Verdict;
  summary: string;
  missingInfo?: string;
  duplicateOf?: number;
  verification?: Verification;
  script?: string;
  blockedCommands: number;
  wallMs: number;
}

const t = text.report;

export function fence(lang: string, body: string): string {
  const safe = body.replace(/```/g, "ˋˋˋ").trim() || "(empty)";
  return `\`\`\`${lang}\n${safe}\n\`\`\``;
}

export function details(title: string, body: string): string {
  return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
}

export function runIcons(v: Verification): string {
  return v.exitCodes.map((c) => (c === 0 ? "🟢" : "🔴")).join(" ");
}

function lead(r: ReportInput): string | undefined {
  if (r.verdict === "confirmed" && r.verification) {
    const seconds = Math.max(1, Math.round(r.wallMs / 1000));
    return fill(t.confirmed, { runs: r.verification.exitCodes.length, seconds });
  }
  if (r.verdict === "duplicate" && r.duplicateOf) {
    return fill(t.duplicateOf, { issue: r.duplicateOf });
  }
  if (r.verdict === "needs-info" && r.missingInfo) {
    return fill(t.missingInfo, { detail: r.missingInfo });
  }
  return undefined;
}

export function renderReport(r: ReportInput): string {
  const rows: [string, string][] = [];
  if (r.verification) {
    rows.push([
      t.runs,
      `${runIcons(r.verification)} &nbsp;<sub>exit ${r.verification.exitCodes.join(", ")}</sub>`,
    ]);
  }
  rows.push([t.sandbox, t.sandboxValue]);
  if (r.blockedCommands > 0) rows.push([t.gate, fill(t.gateValue, { count: r.blockedCommands })]);

  const lines = [fill(t.title, { headline: t.headline[r.verdict] }), ""];
  const first = lead(r);
  if (first) lines.push(first);
  lines.push("", r.summary.trim(), "");
  lines.push("| | |", "|:--|:--|", ...rows.map(([k, v]) => `| **${k}** | ${v} |`), "");
  if (r.script) lines.push(details(t.script, fence("bash", r.script)), "");
  if (r.verification?.lastOutput) {
    lines.push(details(t.output, fence("text", r.verification.lastOutput.slice(-6_000))), "");
  }
  lines.push(t.footer);
  return lines.join("\n");
}
