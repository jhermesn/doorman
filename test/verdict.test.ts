import { describe, expect, it } from "vitest";
import type { ReproOutcome } from "../src/agent/reproduce.js";
import type { Screening } from "../src/agent/screen.js";
import { earlyVerdict, finalVerdict } from "../src/agent/verdict.js";
import { classify } from "../src/agent/verify.js";
import type { RunResult } from "../src/workers.js";

const screening = (over: Partial<Screening> = {}): Screening => ({
  injectionP: 0.05,
  kind: "bug",
  actionable: true,
  duplicateOf: null,
  jevCalls: 1,
  ...over,
});

const repro = (over: Partial<ReproOutcome> = {}): ReproOutcome => ({
  claim: "reproduced",
  summary: "",
  steps: [],
  tokensIn: 0,
  tokensOut: 0,
  jevCalls: 0,
  crashed: false,
  ...over,
});

const run = (exitCode: number, crashed = false): RunResult => ({
  exitCode,
  stdout: "",
  stderr: "",
  durationMs: 1,
  crashed,
});

describe("earlyVerdict", () => {
  it.each([
    [{ injectionP: 0.95 }, "blocked"],
    [{ duplicateOf: { number: 3, p: 0.9 } }, "duplicate"],
    [{ kind: "question" as const }, "not-a-bug"],
    [{ kind: "spam" as const }, "not-a-bug"],
    [{ actionable: false }, "needs-info"],
    [{}, undefined],
  ])("given screening %j, when judged, then the early verdict is %s", (over, expected) => {
    expect(earlyVerdict(screening(over))).toBe(expected);
  });

  it("given an injection that is also a duplicate, when judged, then blocking wins", () => {
    expect(earlyVerdict(screening({ injectionP: 0.9, duplicateOf: { number: 1, p: 1 } }))).toBe(
      "blocked",
    );
  });
});

describe("classify", () => {
  it.each([
    [[1, 1, 1], "fails"],
    [[0, 0, 0], "passes"],
    [[1, 0, 1], "flaky"],
    [[127], "missing"],
  ])("given exit codes %j, when classified, then the outcome is %s", (codes, outcome) => {
    expect(classify(codes.map((c) => run(c))).outcome).toBe(outcome);
  });

  it("given a crashed run, when classified, then it is not counted as failing", () => {
    expect(classify([run(1), run(-1, true)]).outcome).toBe("flaky");
  });
});

describe("finalVerdict", () => {
  it.each([
    [repro(), classify([run(1), run(1), run(1)]), "confirmed"],
    [repro(), classify([run(1), run(0), run(1)]), "cannot-reproduce"],
    [repro(), classify([run(0), run(0), run(0)]), "cannot-reproduce"],
    [repro({ claim: "not-reproduced" }), undefined, "cannot-reproduce"],
    [repro({ claim: "needs-info" }), undefined, "needs-info"],
    [repro({ crashed: true }), undefined, "oom"],
  ])("given claim %j and verification, when judged, then the verdict is %s", (r, v, expected) => {
    expect(finalVerdict(r, v)).toBe(expected);
  });
});
