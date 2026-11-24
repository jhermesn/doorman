import type { Verdict } from "../runlog.js";
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

const HEADLINE: Record<Verdict, string> = {
  confirmed: "✅ Reproduced",
  "needs-info": "❔ Needs one more detail",
  "cannot-reproduce": "🔍 Could not reproduce",
  duplicate: "🔁 Looks like a duplicate",
  "not-a-bug": "💬 Not a bug report",
  blocked: "🛑 Not run: the report asks an automated agent to do something unsafe",
  oom: "💥 The sandbox ran out of memory",
  error: "⚠️ Doorman hit an internal error",
};

export function fence(lang: string, body: string): string {
  const safe = body.replace(/```/g, "ˋˋˋ").trim() || "(empty)";
  return `\`\`\`${lang}\n${safe}\n\`\`\``;
}

export function details(title: string, body: string): string {
  return `<details>\n<summary>${title}</summary>\n\n${body}\n\n</details>`;
}

function runIcons(v: Verification): string {
  const icons = v.exitCodes.map((c) => (c === 0 ? "🟢" : "🔴")).join(" ");
  return `${icons} &nbsp;<sub>exit ${v.exitCodes.join(", ")}</sub>`;
}

export function renderReport(r: ReportInput): string {
  const seconds = Math.max(1, Math.round(r.wallMs / 1000));
  const lines = [`### 🚪 Doorman · ${HEADLINE[r.verdict]}`, ""];

  if (r.verdict === "confirmed" && r.verification) {
    lines.push(
      `> Failed the same way **${r.verification.exitCodes.length} out of ${r.verification.exitCodes.length}** runs in a clean, locked-down sandbox (${seconds}s).`,
    );
  } else if (r.verdict === "duplicate" && r.duplicateOf) {
    lines.push(`> This reads like #${r.duplicateOf}. A maintainer can confirm and close.`);
  } else if (r.verdict === "needs-info" && r.missingInfo) {
    lines.push(`> **What would help:** ${r.missingInfo}`);
  }
  lines.push("", r.summary.trim(), "");

  const rows: [string, string][] = [];
  if (r.verification) rows.push(["Runs", runIcons(r.verification)]);
  rows.push(["Sandbox", "fresh checkpoint · package registries only · no credentials"]);
  if (r.blockedCommands > 0) rows.push(["Gate", `${r.blockedCommands} command(s) refused`]);
  lines.push("| | |", "|:--|:--|", ...rows.map(([k, v]) => `| **${k}** | ${v} |`), "");

  if (r.script) lines.push(details("Reproduction script", fence("bash", r.script)), "");
  if (r.verification?.lastOutput) {
    lines.push(
      details("Output of the last run", fence("text", r.verification.lastOutput.slice(-6_000))),
      "",
    );
  }
  lines.push(
    "<sub>Doorman reproduces reports inside an isolated Fly.io Sprite and gates every command. It never pushes code. Not right? Reply and a maintainer will take it from here.</sub>",
  );
  return lines.join("\n");
}
