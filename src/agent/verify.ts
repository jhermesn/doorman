import type { RunResult, Workers } from "../workers.js";
import { REPRO_FILE } from "./reproduce.js";

export interface Verification {
  exitCodes: number[];
  crashed: boolean;
  lastOutput: string;
  outcome: "fails" | "passes" | "flaky" | "missing";
}

/** Runs the repro script several times. Only a consistent result counts. */
export async function verify(
  workers: Workers,
  worker: string,
  dir: string,
  runs: number,
  timeoutMs: number,
): Promise<Verification> {
  const results: RunResult[] = [];
  for (let i = 0; i < runs; i++) {
    const r = await workers.run(worker, `test -f ${REPRO_FILE} || exit 127; bash ${REPRO_FILE}`, {
      cwd: dir,
      timeoutMs,
    });
    results.push(r);
    if (r.crashed) break;
  }
  return classify(results);
}

export function classify(results: RunResult[]): Verification {
  const exitCodes = results.map((r) => r.exitCode);
  const last = results.at(-1);
  const lastOutput = last ? `${last.stdout}\n${last.stderr}`.trim() : "";
  const crashed = results.some((r) => r.crashed);
  let outcome: Verification["outcome"];
  if (exitCodes.includes(127) || exitCodes.length === 0) outcome = "missing";
  else if (exitCodes.every((c) => c !== 0) && !crashed) outcome = "fails";
  else if (exitCodes.every((c) => c === 0)) outcome = "passes";
  else outcome = "flaky";
  return { exitCodes, crashed, lastOutput, outcome };
}
