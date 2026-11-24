import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redact } from "./redact.js";

export type Verdict =
  | "confirmed"
  | "needs-info"
  | "cannot-reproduce"
  | "duplicate"
  | "not-a-bug"
  | "blocked"
  | "oom"
  | "error";

export interface Step {
  cmd: string;
  gate: { allowP: number; decision: "allow" | "block" };
  exitCode?: number;
  ms?: number;
  crashed?: boolean;
}

export interface RunRecord {
  runId: string;
  ts: string;
  repo: string;
  kind: "issue" | "pr";
  ref: number;
  mode: "demo" | "shadow";
  issueSha256: string;
  screen?: { injectionP: number; kind: string; duplicateOf: string | null };
  steps: Step[];
  verdict: Verdict;
  verifyRuns: number[];
  prCheck?: { base: "fail" | "pass"; head: "fail" | "pass" };
  model: string;
  tokensIn: number;
  tokensOut: number;
  jevCalls: number;
  restoreMs: number;
  wallMs: number;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** One JSON line per job. Issue text is stored only as a hash; commands are redacted. */
export function appendRun(path: string, record: RunRecord): void {
  mkdirSync(dirname(path), { recursive: true });
  const safe: RunRecord = {
    ...record,
    steps: record.steps.map((s) => ({ ...s, cmd: redact(s.cmd) })),
  };
  appendFileSync(path, `${JSON.stringify(safe)}\n`);
}
