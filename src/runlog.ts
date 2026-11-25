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

/** demo: posts and remembers; shadow: read-only on real repos; eval: a corpus file, nothing written. */
export type RunMode = "demo" | "shadow" | "eval";

/** Which optional layers were on for a run, so results from different setups aren't mixed. */
export interface Layers {
  jev: boolean;
  duplicates: boolean;
  notes: boolean;
}

export interface RunRecord {
  runId: string;
  ts: string;
  doormanVersion: string;
  repo: string;
  kind: "issue";
  ref: number;
  mode: RunMode;
  layers: Layers;
  issueSha256: string;
  screen?: {
    injectionP: number;
    kind: string;
    duplicateOf: string | null;
    duplicateP: number | null;
  };
  steps: Step[];
  verdict: Verdict;
  verifyRuns: number[];
  /** Worker checkpoint of the failing state, or why saving it failed. */
  checkpoint?: string;
  checkpointError?: string;
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

export interface PrRecord {
  runId: string;
  ts: string;
  doormanVersion: string;
  repo: string;
  kind: "pr";
  ref: number;
  issue: number | null;
  state: "success" | "failure" | "error";
  baseRuns: number[];
  headRuns: number[];
  sameFailureP: number | null;
  restoreMs: number;
  wallMs: number;
}
