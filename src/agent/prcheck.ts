import type { Deps } from "../clients.js";
import type { RepoConfig } from "../config.js";
import { ownerRepo } from "../github.js";
import { fill, text } from "../text.js";
import { details, fence, runIcons } from "./report.js";
import { REPRO_FILE } from "./reproduce.js";
import { prepareWorker } from "./triage.js";
import { type Verification, verify } from "./verify.js";

const t = text.prCheck;

/** GitHub's documented closing keywords: https://docs.github.com/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue */
const CLAIM = /\b(?:fix(?:e[sd])?|close[sd]?|resolve[sd]?)\s+#(\d+)/i;

export function claimedIssue(title: string, body: string | null | undefined): number | undefined {
  const match = `${title}\n${body ?? ""}`.match(CLAIM);
  return match?.[1] ? Number(match[1]) : undefined;
}

export interface PrCheck {
  issue: number | undefined;
  base?: Verification;
  head?: Verification;
  state: "success" | "failure" | "error";
  description: string;
  report: string;
}

export function judge(
  base: Verification,
  head: Verification,
): Pick<PrCheck, "state" | "description"> {
  if (base.outcome !== "fails") {
    return { state: "error", description: t.status.baseNoLongerFails };
  }
  if (head.outcome === "passes") {
    return { state: "success", description: t.status.holds };
  }
  return { state: "failure", description: t.status.stillFails };
}

async function runAt(
  deps: Deps,
  repo: RepoConfig,
  ref: string,
  script: string,
): Promise<Verification> {
  await prepareWorker(deps, repo, ref);
  await deps.workers.writeFile(repo.worker, `${repo.dir}/${REPRO_FILE}`, script);
  const { verifyRuns, commandTimeoutMs } = deps.config.limits;
  return verify(deps.workers, repo.worker, repo.dir, verifyRuns, commandTimeoutMs);
}

function row(label: string, v: Verification): string {
  return `| **${label}** | ${runIcons(v)} | ${v.outcome} |`;
}

export async function checkPr(
  deps: Deps,
  repo: RepoConfig,
  number: number,
  opts: { write: boolean },
): Promise<PrCheck> {
  const target = ownerRepo(repo.repo);
  const { data: pr } = await deps.github.rest.pulls.get({ ...target, pull_number: number });
  const issue = claimedIssue(pr.title, pr.body);
  const folderId = await deps.box.folderFor(repo.repo);
  const script = issue ? await deps.box.read(folderId, `repro-${issue}.sh`) : undefined;

  if (!issue || !script) {
    const description = issue ? fill(t.status.noRepro, { issue }) : t.status.noClaim;
    return { issue, state: "error", description, report: description };
  }

  const base = await runAt(deps, repo, pr.base.sha, script);
  const head = await runAt(deps, repo, `pull/${number}/head`, script);
  const verdict = judge(base, head);
  const report = [
    fill(text.report.title, { headline: t.headline[verdict.state] }),
    "",
    fill(t.intro, { issue, runs: base.exitCodes.length }),
    "",
    "| | Runs | Result |",
    "|:--|:--|:--|",
    row(fill(t.base, { ref: pr.base.ref }), base),
    row(t.head, head),
    "",
    details(fill(t.script, { issue }), fence("bash", script)),
    "",
    t.footer,
  ].join("\n");

  if (opts.write && repo.write) {
    await deps.github.rest.repos.createCommitStatus({
      ...target,
      sha: pr.head.sha,
      state: verdict.state,
      context: "doorman/repro",
      description: verdict.description.slice(0, 140),
    });
    await deps.github.rest.issues.createComment({ ...target, issue_number: number, body: report });
  }
  return { issue, base, head, ...verdict, report };
}
