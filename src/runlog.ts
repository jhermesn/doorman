import { createHash } from "node:crypto";

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
  /** Absent when no Jev connector is configured. */
  gate?: { allowP: number; decision: "allow" | "block" };
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
