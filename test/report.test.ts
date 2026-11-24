import { describe, expect, it } from "vitest";
import { renderReport, scriptFromReport } from "../src/agent/report.js";
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
      gated: true,
      wallMs: 42_000,
    });
    expect(md).toContain("✅ Reproduced");
    expect(md).toContain("**3 out of 3**");
    expect(md).toContain("🔴 🔴 🔴");
    expect(md).toContain("<summary>Reproduction script</summary>");
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
      gated: true,
      wallMs: 1,
    });
    expect(md.match(/```/g)).toHaveLength(2);
  });

  it("given a blocked report, when rendered, then it explains nothing was run", () => {
    const md = renderReport({
      verdict: "blocked",
      summary: "Nothing ran.",
      blockedCommands: 0,
      gated: true,
      wallMs: 1,
    });
    expect(md).toContain("🛑");
  });
});

describe("scriptFromReport", () => {
  it("given a confirmed report, when the script is read back, then it matches what was rendered", () => {
    const script = "#!/usr/bin/env bash\nnode check.mjs";
    const md = renderReport({
      verdict: "confirmed",
      summary: "",
      script,
      blockedCommands: 0,
      gated: true,
      wallMs: 1,
    });
    expect(scriptFromReport(md)).toBe(script);
  });

  it("given a report without a script, when it is read, then there is nothing to check", () => {
    const md = renderReport({
      verdict: "needs-info",
      summary: "",
      blockedCommands: 0,
      gated: true,
      wallMs: 1,
    });
    expect(scriptFromReport(md)).toBeUndefined();
  });
});

describe("renderReport without Jev", () => {
  it("given no gate, when rendered, then the report says commands ran ungated", () => {
    const md = renderReport({
      verdict: "cannot-reproduce",
      summary: "",
      blockedCommands: 0,
      gated: false,
      wallMs: 1,
    });
    expect(md).toContain("no Jev connector");
  });
});
