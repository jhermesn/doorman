import { randomUUID } from "node:crypto";
import { type BoxMemory, MEMORY_FILES } from "../box.js";
import type { Config, RepoConfig } from "../config.js";
import type { GitHub } from "../github.js";
import type { Jev } from "../jev.js";
import type { Ollama } from "../ollama.js";
import { type IssueMemory, namespaceFor } from "../pinecone.js";
import { appendRun, type RunRecord, sha256, type Verdict } from "../runlog.js";
import type { Workers } from "../workers.js";
import { renderReport } from "./report.js";
import { REPRO_FILE, type ReproOutcome, reproduce } from "./reproduce.js";
import { issueText, screen } from "./screen.js";
import { earlyVerdict, finalVerdict, LABELS } from "./verdict.js";
import { type Verification, verify } from "./verify.js";

export interface Deps {
  config: Config;
  github: GitHub;
  jev: Jev;
  ollama: Ollama;
  issues: IssueMemory;
  box: BoxMemory;
  workers: Workers;
}

export interface TriageResult {
  verdict: Verdict;
  report: string;
  record: RunRecord;
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
  ].filter(Boolean);
  for (const cmd of steps) {
    const r = await deps.workers.run(repo.worker, cmd as string, {
      cwd: repo.dir,
      timeoutMs: 600_000,
    });
    if (r.exitCode !== 0) throw new Error(`preparing ${repo.repo} failed: ${r.stderr.slice(-500)}`);
  }
  return restoreMs;
}

export async function triageIssue(
  deps: Deps,
  repo: RepoConfig,
  number: number,
  opts: { mode: "demo" | "shadow"; write: boolean },
): Promise<TriageResult> {
  const started = Date.now();
  const { config, github, jev, ollama, issues, box, workers } = deps;
  const issue = await github.issue(repo.repo, number);
  if (issue.pull_request) throw new Error(`#${number} is a pull request; use check-pr`);

  const namespace = namespaceFor(repo.repo);
  const folderId = await box.folderFor(repo.repo);
  const screening = await screen(jev, issues, namespace, issue);
  let verdict = earlyVerdict(screening);

  let repro: ReproOutcome | undefined;
  let verification: Verification | undefined;
  let script: string | undefined;
  let restoreMs = 0;

  if (!verdict) {
    restoreMs = await prepareWorker(deps, repo);
    repro = await reproduce(ollama, jev, workers, {
      repo: repo.repo,
      worker: repo.worker,
      dir: repo.dir,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      memory: await loadNotes(box, folderId),
      model: config.models.reproduce,
      maxSteps: config.limits.stepsPerJob,
      commandTimeoutMs: config.limits.commandTimeoutMs,
    });
    if (repro.claim === "reproduced" && !repro.crashed) {
      verification = await verify(
        workers,
        repo.worker,
        repo.dir,
        config.limits.verifyRuns,
        config.limits.commandTimeoutMs,
      );
    }
    verdict = finalVerdict(repro, verification);
    if (verdict === "confirmed")
      script = await workers.readFile(repo.worker, `${repo.dir}/${REPRO_FILE}`);
  }

  const wallMs = Date.now() - started;
  const report = renderReport({
    verdict,
    summary: repro?.summary ?? summaryFor(verdict),
    ...(repro?.missingInfo ? { missingInfo: repro.missingInfo } : {}),
    ...(screening.duplicateOf ? { duplicateOf: screening.duplicateOf.number } : {}),
    ...(verification ? { verification } : {}),
    ...(script ? { script } : {}),
    blockedCommands: repro?.steps.filter((s) => s.gate.decision === "block").length ?? 0,
    wallMs,
  });

  if (opts.write && repo.write) {
    await github.comment(repo.repo, number, report);
    const label = LABELS[verdict];
    if (label) await github.addLabels(repo.repo, number, [label]);
  }
  if (opts.mode === "demo") {
    if (script) await box.write(folderId, `repro-${number}.sh`, script);
    await box.append(
      folderId,
      "log.md",
      `- ${new Date().toISOString()} #${number} → **${verdict}**`,
    );
  }
  await issues.upsert(namespace, [
    { _id: `issue-${number}`, text: issueText(issue).slice(0, 8_000), title: issue.title, verdict },
  ]);

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
  appendRun(config.runLog, record);
  return { verdict, report, record };
}

function summaryFor(verdict: Verdict): string {
  switch (verdict) {
    case "blocked":
      return "The report contains instructions aimed at automated tools, so Doorman did not run anything. A maintainer should read it first.";
    case "duplicate":
      return "A very similar report already exists.";
    case "not-a-bug":
      return "This reads as a question, feature request or docs issue rather than a defect, so there is nothing to reproduce.";
    case "needs-info":
      return "The report doesn't include code, commands or steps that Doorman could run.";
    default:
      return "";
  }
}
