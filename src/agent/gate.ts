import type { TypeSafeClient } from "@typesafe-ai/sdk";
import { text } from "../text.js";

export const ALLOW_THRESHOLD = 0.6;

export interface GateDecision {
  decision: "allow" | "block";
  allowP: number;
}

/**
 * A typed safety check on each command. Jev sees only the command, never the bug report,
 * so text in the report can't argue a command through. It is not the security boundary:
 * the worker's network, privilege and memory policies are what hold when Jev is wrong.
 */
export async function gate(jev: TypeSafeClient, command: string): Promise<GateDecision> {
  const { answers } = await jev.systemOne({
    state: { proposed_command: command },
    questions: {
      gate: { type: "choice", ...text.jev.gate },
    },
  });
  const allowP = answers.gate.probabilities.allow;
  return { decision: allowP >= ALLOW_THRESHOLD ? "allow" : "block", allowP };
}
