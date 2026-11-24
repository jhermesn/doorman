import type { Verdict } from "../runlog.js";
import type { ReproOutcome } from "./reproduce.js";
import type { Screening } from "./screen.js";
import type { Verification } from "./verify.js";

export const INJECTION_THRESHOLD = 0.8;

/** Decided before any code runs. Returns undefined when Doorman should try to reproduce. */
export function earlyVerdict(s: Screening): Verdict | undefined {
  if (s.injectionP >= INJECTION_THRESHOLD) return "blocked";
  if (s.duplicateOf) return "duplicate";
  if (s.kind === "question" || s.kind === "feature" || s.kind === "docs" || s.kind === "spam") {
    return "not-a-bug";
  }
  if (!s.actionable) return "needs-info";
  return undefined;
}

/** The agent's claim only counts when the repro script agrees with it, every time. */
export function finalVerdict(repro: ReproOutcome, v: Verification | undefined): Verdict {
  if (repro.crashed || v?.crashed) return "oom";
  if (repro.claim === "needs-info") return "needs-info";
  if (repro.claim === "reproduced" && v?.outcome === "fails") return "confirmed";
  return "cannot-reproduce";
}

export const LABELS: Partial<Record<Verdict, string>> = {
  confirmed: "repro:confirmed",
  "needs-info": "repro:needs-info",
  "cannot-reproduce": "repro:cannot-reproduce",
  duplicate: "duplicate",
};
