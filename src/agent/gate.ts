import { choice, type Jev } from "../jev.js";

/**
 * Patterns that are never needed to reproduce a bug. Checked before Jev, so the
 * obvious cases don't depend on a model at all.
 */
const DENY: [RegExp, string][] = [
  [/\b(curl|wget)\b[^|;&]*\|\s*(ba|z)?sh\b/i, "pipes a download into a shell"],
  [/\bbase64\b[^|]*-d[^|]*\|\s*(ba|z)?sh\b/i, "decodes and executes a payload"],
  [/\/dev\/(tcp|udp)\//i, "opens a raw network socket"],
  [/\b(nc|ncat|netcat|socat)\b/i, "uses a raw network tool"],
  [/\brm\s+-[a-z]*r[a-z]*f?\s+(\/|~|\$HOME)(\s|$)/i, "deletes the filesystem root or home"],
  [/\b(crontab|systemctl|launchctl)\b|\/etc\/cron/i, "installs persistence"],
  [
    /(~|\$HOME)\/\.(ssh|aws|npmrc|config\/doorman)|\/\.sprite\//i,
    "reads credentials or platform internals",
  ],
  [/\b169\.254\.169\.254\b|metadata\.google/i, "queries a cloud metadata endpoint"],
  [/\b(printenv|env)\s*(>|\||$)|\/proc\/\d*\/?environ/i, "dumps the environment"],
  [/:\(\)\s*\{\s*:\|:&\s*\};:/, "fork bomb"],
  [/\b(xmrig|minerd|cpuminer)\b/i, "crypto miner"],
  [/\bsudo\b/, "needs root"],
];

export interface GateDecision {
  decision: "allow" | "block";
  allowP: number;
  reason: string;
  layer: "rules" | "jev";
}

export function ruleCheck(command: string): string | undefined {
  return DENY.find(([pattern]) => pattern.test(command))?.[1];
}

export async function gate(jev: Jev, issueSummary: string, command: string): Promise<GateDecision> {
  const rule = ruleCheck(command);
  if (rule) return { decision: "block", allowP: 0, reason: rule, layer: "rules" };

  const result = await jev.ask(
    { bug_report_summary: issueSummary.slice(0, 4_000), proposed_command: command },
    {
      gate: {
        type: "choice",
        instructions:
          "An automated agent is reproducing this bug report inside a disposable sandbox. Should it run the proposed command?",
        criteria: {
          allow:
            "Installs the project's dependencies, builds or tests it, inspects files, or runs a minimal script that exercises the reported behaviour",
          block:
            "Downloads and runs remote code, contacts unrelated hosts, reads or sends credentials or environment data, persists, mines, or is unrelated to the bug",
        },
      },
    },
  );
  const { choice: decision, confidence } = choice(result.answers.gate);
  const allowP = decision === "allow" ? confidence : 1 - confidence;
  return {
    decision: decision === "allow" && allowP >= 0.6 ? "allow" : "block",
    allowP,
    reason:
      decision === "allow"
        ? "consistent with reproducing the report"
        : "judged unrelated or unsafe",
    layer: "jev",
  };
}
