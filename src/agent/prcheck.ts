import { randomUUID } from "node:crypto";
import type { TypeSafeClient } from "@typesafe-ai/sdk";
import type { Deps } from "../clients.js";
import type { RepoConfig } from "../config.js";
import { findDoormanComment, ownerRepo, upsertComment } from "../github.js";
import type { PrRecord } from "../runlog.js";
import { fill, text } from "../text.js";
import { VERSION } from "../version.js";
import { details, fence, outputFromReport, runIcons, scriptFromReport } from "./report.js";
import { REPRO_FILE } from "./reproduce.js";
import { prepareWorker } from "./triage.js";
import { type Verification, verify } from "./verify.js";

const t = text.prCheck;

/** Below this, Jev doesn't think base fails the way the confirmed run did. */
export const SAME_FAILURE_THRESHOLD = 0.5;

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
  /** Jev's probability that base fails the way the confirmed run did; absent without Jev or a stored output. */
  sameFailureP?: number;
  state: "success" | "failure" | "error";
  description: string;
  report: string;
  record: PrRecord;
}

/**
 * The scripts decide. Jev's comparison can only withhold a verdict when base fails for some
 * other reason (a broken install, a changed API); it never turns a failing check green.
 */
export function judge(
  base: Verification,
  head: Verification,
  sameFailureP?: number,
): Pick<PrCheck, "state" | "description"> {
  if (base.outcome !== "fails") {
    return { state: "error", description: t.status.baseNoLongerFails };
  }
  if (sameFailureP !== undefined && sameFailureP < SAME_FAILURE_THRESHOLD) {
    return { state: "error", description: t.status.baseFailsDifferently };
  }
  if (head.outcome === "passes") {
    return { state: "success", description: t.status.holds };
  }
  return { state: "failure", description: t.status.stillFails };
}

async function sameFailure(jev: TypeSafeClient, confirmed: string, base: string): Promise<number> {
  const { answers } = await jev.systemOne({
    state: { confirmed_output: confirmed.slice(-4_000), base_output: base.slice(-4_000) },
    questions: { same: { type: "noul", instructions: text.jev.sameFailure } },
  });
  return answers.same.noul;
}

async function runAt(
  deps: Deps,
  repo: RepoConfig,
  ref: string,
  script: string,
): Promise<{ verification: Verification; restoreMs: number }> {
  const restoreMs = await prepareWorker(deps, repo, ref);
  await deps.workers.writeFile(repo.worker, `${repo.dir}/${REPRO_FILE}`, script);
  const { verifyRuns, commandTimeoutMs } = deps.config.limits;
  const verification = await verify(
    deps.workers,
    repo.worker,
    repo.dir,
    verifyRuns,
    commandTimeoutMs,
  );
  return { verification, restoreMs };
}

interface StoredRepro {
  script: string;
  output?: string;
}

/** Box keeps the archive when configured; otherwise both come from Doorman's issue report. */
async function storedRepro(
  deps: Deps,
  repo: string,
  issue: number,
): Promise<StoredRepro | undefined> {
  const folder = deps.box ? await deps.box.folderFor(repo) : undefined;
  const archived = folder
    ? await Promise.all([
        deps.box?.read(folder, `repro-${issue}.sh`),
        deps.box?.read(folder, `repro-${issue}.out`),
      ])
    : [];
  let [script, output] = archived;
  if (!script || !output) {
    const comment = await findDoormanComment(deps.github, {
      ...ownerRepo(repo),
      issue_number: issue,
    });
    const body = comment?.body ?? "";
    script ??= scriptFromReport(body);
    output ??= outputFromReport(body);
  }
  return script ? { script, ...(output ? { output } : {}) } : undefined;
}

function row(label: string, v: Verification): string {
  return `| **${label}** | ${runIcons(v)} | ${v.outcome} |`;
}

function prRecord(
  repo: string,
  number: number,
  fields: Omit<PrRecord, "runId" | "ts" | "doormanVersion" | "repo" | "kind" | "ref">,
): PrRecord {
  return {
    runId: randomUUID(),
    ts: new Date().toISOString(),
    doormanVersion: VERSION,
    repo,
    kind: "pr",
    ref: number,
    ...fields,
  };
}

export async function checkPr(
  deps: Deps,
  repo: RepoConfig,
  number: number,
  opts: { write: boolean },
): Promise<PrCheck> {
  const started = Date.now();
  const target = ownerRepo(repo.repo);
  const { data: pr } = await deps.github.rest.pulls.get({ ...target, pull_number: number });
  const issue = claimedIssue(pr.title, pr.body);
  const stored = issue ? await storedRepro(deps, repo.repo, issue) : undefined;

  if (!issue || !stored) {
    const description = issue ? fill(t.status.noRepro, { issue }) : t.status.noClaim;
    const record = prRecord(repo.repo, number, {
      issue: issue ?? null,
      state: "error",
      baseRuns: [],
      headRuns: [],
      sameFailureP: null,
      restoreMs: 0,
      wallMs: Date.now() - started,
    });
    return { issue, state: "error", description, report: description, record };
  }

  const { script, output } = stored;
  const onBase = await runAt(deps, repo, pr.base.sha, script);
  const base = onBase.verification;
  const sameFailureP =
    deps.jev && output && base.outcome === "fails"
      ? await sameFailure(deps.jev, output, base.lastOutput)
      : undefined;
  const onHead = await runAt(deps, repo, `pull/${number}/head`, script);
  const head = onHead.verification;
  const verdict = judge(base, head, sameFailureP);
  const match =
    sameFailureP === undefined
      ? []
      : [
          fill(sameFailureP < SAME_FAILURE_THRESHOLD ? t.differentFailure : t.sameFailure, {
            issue,
          }),
          "",
        ];
  const report = [
    fill(text.report.title, { headline: t.headline[verdict.state] }),
    "",
    fill(t.intro, { issue, runs: base.exitCodes.length }),
    "",
    ...match,
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
    await upsertComment(deps.github, { ...target, issue_number: number }, report);
  }
  const record = prRecord(repo.repo, number, {
    issue,
    state: verdict.state,
    baseRuns: base.exitCodes,
    headRuns: head.exitCodes,
    sameFailureP: sameFailureP ?? null,
    restoreMs: onBase.restoreMs + onHead.restoreMs,
    wallMs: Date.now() - started,
  });
  return {
    issue,
    base,
    head,
    ...(sameFailureP === undefined ? {} : { sameFailureP }),
    ...verdict,
    report,
    record,
  };
}
