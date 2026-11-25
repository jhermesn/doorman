import { randomUUID } from "node:crypto";
import type { Octokit } from "@octokit/rest";
import { type BoxMemory, MEMORY_FILES } from "../box.js";
import type { Deps } from "../clients.js";
import type { RepoConfig } from "../config.js";
import { ownerRepo, upsertComment } from "../github.js";
import { type RunMode, type RunRecord, sha256, type Verdict } from "../runlog.js";
import { text } from "../text.js";
import { renderReport } from "./report.js";
import { REPRO_FILE, type ReproOutcome, reproduce } from "./reproduce.js";
import { type IssueLike, issueText, screen } from "./screen.js";
import { earlyVerdict, finalVerdict, LABELS } from "./verdict.js";
import { type Verification, verify } from "./verify.js";

export interface TriageResult {
  verdict: Verdict;
  report: string;
  record: RunRecord;
}

export interface IssueInput extends IssueLike {
  labels: string[];
  createdAt?: string;
}

export async function fetchIssue(
  github: Octokit,
  repo: string,
  number: number,
): Promise<IssueInput> {
  const { data } = await github.rest.issues.get({ ...ownerRepo(repo), issue_number: number });
  if (data.pull_request) throw new Error(`#${number} is a pull request; use check-pr`);
  return {
    number,
    title: data.title,
    body: data.body ?? null,
    labels: data.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))),
    createdAt: data.created_at,
  };
}

/** A report kept as Markdown, as in the eval corpus: the first line is the title. */
export function issueFromMarkdown(markdown: string, number: number): IssueInput {
  const [first = "", ...rest] = markdown.trim().split("\n");
  const title = first.startsWith("# ") ? first.slice(2) : first;
  return { number, title: title.trim(), body: rest.join("\n").trim(), labels: [] };
}

export function namespaceFor(repo: string): string {
  return repo.toLowerCase().replace(/[^a-z0-9-]/g, "-");
}

async function loadNotes(box: BoxMemory, folderId: string): Promise<string> {
  const parts = await Promise.all(
    MEMORY_FILES.map(async (f) => [f, await box.read(folderId, f)] as const),
  );
  return parts
    .filter(([, text]) => text?.trim())
    .map(([f, text]) => `## ${f}\n${text}`)
    .join("\n\n");
}

/** Restores the clean environment and checks out a ref. Trusted commands only. */
export async function prepareWorker(
  deps: Deps,
  repo: RepoConfig,
  fetchRef?: string,
): Promise<number> {
  const started = Date.now();
  await deps.workers.reset(repo.worker, repo.golden);
  const restoreMs = Date.now() - started;
  const steps = [
    fetchRef
      ? `git fetch -q --depth 1 origin ${fetchRef} && git checkout -q FETCH_HEAD`
      : undefined,
    repo.prepare,
  ].filter((cmd): cmd is string => Boolean(cmd));
  for (const cmd of steps) {
    const r = await deps.workers.run(repo.worker, cmd, { cwd: repo.dir, timeoutMs: 600_000 });
    if (r.exitCode !== 0) throw new Error(`preparing ${repo.repo} failed: ${r.stderr.slice(-500)}`);
  }
  return restoreMs;
}

export async function triageIssue(
  deps: Deps,
  repo: RepoConfig,
  issue: IssueInput,
  opts: { mode: RunMode; write: boolean; ref?: string },
): Promise<TriageResult> {
  const started = Date.now();
  const { config, github, jev, model, box, workers } = deps;
  const { number } = issue;
  const target = { ...ownerRepo(repo.repo), issue_number: number };
  // Only live issues feed the duplicate index; eval and shadow runs must not leave traces in it.
  const index = opts.mode === "demo" ? deps.issueIndex?.(namespaceFor(repo.repo)) : undefined;
  const folderId = box ? await box.folderFor(repo.repo) : undefined;
  const screening = await screen(jev, index, issue);
  let verdict = earlyVerdict(screening);

  let repro: ReproOutcome | undefined;
  let verification: Verification | undefined;
  let script: string | undefined;
  let restoreMs = 0;
  let checkpoint: SavedState = {};

  if (!verdict) {
    restoreMs = await prepareWorker(deps, repo, opts.ref);
    repro = await reproduce(model, jev, workers, {
      repo: repo.repo,
      worker: repo.worker,
      dir: repo.dir,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      memory: box && folderId ? await loadNotes(box, folderId) : "",
      maxSteps: config.limits.stepsPerJob,
      commandTimeoutMs: config.limits.commandTimeoutMs,
    });
    const attempted = repro.claim === "reproduced" || repro.claim === "unfinished";
    if (attempted && !repro.crashed) {
      verification = await verify(
        workers,
        repo.worker,
        repo.dir,
        config.limits.verifyRuns,
        config.limits.commandTimeoutMs,
      );
    }
    verdict = finalVerdict(repro, verification);
    if (verdict === "confirmed") {
      script = await workers.readFile(repo.worker, `${repo.dir}/${REPRO_FILE}`);
      if (opts.mode === "demo") checkpoint = await saveFailingState(deps, repo, number);
    }
  }

  const wallMs = Date.now() - started;
  const report = renderReport({
    verdict,
    summary: unfinishedButProven(repro, verdict)
      ? text.report.unfinishedConfirmed
      : (repro?.summary ?? summaryFor(verdict)),
    ...(repro?.missingInfo ? { missingInfo: repro.missingInfo } : {}),
    ...(screening.duplicateOf ? { duplicateOf: screening.duplicateOf.number } : {}),
    ...(verification ? { verification } : {}),
    ...(script ? { script } : {}),
    ...(checkpoint.id
      ? { stepInto: { worker: repo.worker, checkpoint: checkpoint.id, dir: repo.dir } }
      : {}),
    blockedCommands: repro?.steps.filter((s) => s.gate?.decision === "block").length ?? 0,
    gated: Boolean(jev),
    wallMs,
  });

  if (opts.write && repo.write) {
    await upsertComment(github, target, report);
    const label = LABELS[verdict];
    // A rerun replaces the previous verdict's label instead of stacking a contradicting one.
    for (const old of issue.labels) {
      if (old !== label && Object.values(LABELS).includes(old)) {
        await github.rest.issues.removeLabel({ ...target, name: old });
      }
    }
    if (label) await github.rest.issues.addLabels({ ...target, labels: [label] });
  }
  if (opts.mode === "demo" && box && folderId) {
    if (script) await box.write(folderId, `repro-${number}.sh`, script);
    if (script && verification) {
      await box.write(folderId, `repro-${number}.out`, verification.lastOutput);
    }
    await box.append(
      folderId,
      "log.md",
      `- ${new Date().toISOString()} #${number} → **${verdict}**`,
    );
  }
  await index?.upsertRecords({
    records: [
      {
        _id: `issue-${number}`,
        text: issueText(issue).slice(0, 8_000),
        title: issue.title,
        verdict,
      },
    ],
  });

  const record: RunRecord = {
    runId: randomUUID(),
    ts: new Date().toISOString(),
    repo: repo.repo,
    kind: "issue",
    ref: number,
    mode: opts.mode,
    issueSha256: sha256(issueText(issue)),
    screen: {
      injectionP: screening.injectionP,
      kind: screening.kind,
      duplicateOf: screening.duplicateOf ? `#${screening.duplicateOf.number}` : null,
    },
    steps: repro?.steps ?? [],
    verdict,
    verifyRuns: verification?.exitCodes ?? [],
    model: config.models.reproduce,
    tokensIn: repro?.tokensIn ?? 0,
    tokensOut: repro?.tokensOut ?? 0,
    jevCalls: screening.jevCalls + (repro?.jevCalls ?? 0),
    restoreMs,
    wallMs,
  };
  return { verdict, report, record };
}

interface SavedState {
  id?: string;
  error?: string;
}

/** A failed checkpoint only loses the step-into shortcut, so the verdict still stands. */
async function saveFailingState(deps: Deps, repo: RepoConfig, issue: number): Promise<SavedState> {
  try {
    const id = await deps.workers.checkpoint(repo.worker, `doorman repro #${issue}`);
    return id ? { id } : { error: "the checkpoint stream returned no version id" };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function unfinishedButProven(repro: ReproOutcome | undefined, verdict: Verdict): boolean {
  return repro?.claim === "unfinished" && verdict === "confirmed";
}

function summaryFor(verdict: Verdict): string {
  const summaries: Partial<Record<Verdict, string>> = text.report.summary;
  return summaries[verdict] ?? "";
}
