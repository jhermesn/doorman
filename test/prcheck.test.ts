import { describe, expect, it } from "vitest";
import { claimedIssue, judge } from "../src/agent/prcheck.js";
import { classify } from "../src/agent/verify.js";

const v = (codes: number[]) =>
  classify(
    codes.map((exitCode) => ({ exitCode, stdout: "", stderr: "", durationMs: 1, crashed: false })),
  );

describe("claimedIssue", () => {
  it.each([
    ["Fix DST parsing", "Fixes #12", 12],
    ["fix: coupon reuse (closes #7)", null, 7],
    ["Resolved #3 by clamping", "", 3],
    ["Refactor parser", "Related to #9", undefined],
  ])(
    "given title %j and body %j, when parsed, then the claimed issue is %s",
    (title, body, expected) => {
      expect(claimedIssue(title, body)).toBe(expected);
    },
  );
});

describe("judge", () => {
  it("given the repro fails on base and passes on the PR, when judged, then the fix holds", () => {
    expect(judge(v([1, 1, 1]), v([0, 0, 0])).state).toBe("success");
  });

  it("given the repro still fails on the PR, when judged, then the claim is rejected", () => {
    expect(judge(v([1, 1, 1]), v([1, 1, 1])).state).toBe("failure");
  });

  it("given a flaky result on the PR, when judged, then the claim is rejected", () => {
    expect(judge(v([1, 1, 1]), v([0, 1, 0])).state).toBe("failure");
  });

  it("given the repro already passes on base, when judged, then the check errors out", () => {
    expect(judge(v([0, 0, 0]), v([0, 0, 0])).state).toBe("error");
  });
});
