import { describe, expect, it } from "vitest";
import { renderReport } from "../src/agent/report.js";
import { classify } from "../src/agent/verify.js";

const failing = classify(
  [1, 1, 1].map((exitCode) => ({
    exitCode,
    stdout: "expected 2, got 3",
    stderr: "",
    durationMs: 1,
    crashed: false,
  })),
);

describe("renderReport", () => {
  it("given a confirmed bug, when rendered, then it shows the headline, runs and script", () => {
    const md = renderReport({
      verdict: "confirmed",
      summary: "getHours() is off by one at the DST boundary.",
      verification: failing,
      script: "node repro.mjs",
      blockedCommands: 0,
      wallMs: 42_000,
    });
    expect(md).toContain("✅ Reproduced");
    expect(md).toContain("**3 out of 3**");
    expect(md).toContain("🔴 🔴 🔴");
    expect(md).toContain("<summary>Reproduction script</summary>");
  });

  it("given output containing a token, when rendered, then the token is masked", () => {
    const leaky = classify([
      { exitCode: 1, stdout: `ghp_${"x".repeat(36)}`, stderr: "", durationMs: 1, crashed: false },
    ]);
    const md = renderReport({
      verdict: "confirmed",
      summary: "",
      verification: leaky,
      blockedCommands: 0,
      wallMs: 1,
    });
    expect(md).not.toContain(`ghp_${"x".repeat(36)}`);
  });

  it("given output containing a code fence, when rendered, then the comment layout survives", () => {
    const tricky = classify([
      { exitCode: 1, stdout: "```\n# injected heading", stderr: "", durationMs: 1, crashed: false },
    ]);
    const md = renderReport({
      verdict: "confirmed",
      summary: "",
      verification: tricky,
      blockedCommands: 0,
      wallMs: 1,
    });
    expect(md.match(/```/g)).toHaveLength(2);
  });

  it("given a blocked report, when rendered, then it explains nothing was run", () => {
    const md = renderReport({
      verdict: "blocked",
      summary: "Nothing ran.",
      blockedCommands: 0,
      wallMs: 1,
    });
    expect(md).toContain("🛑");
  });
});
