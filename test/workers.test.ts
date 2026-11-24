import { ExecError } from "@fly/sprites";
import { describe, expect, it } from "vitest";
import { fromError } from "../src/workers.js";

describe("fromError", () => {
  it("given a command that exits non-zero, when it rejects, then the exit code is kept and nothing crashed", () => {
    const failed = new ExecError("Command failed with exit code 1", {
      exitCode: 1,
      stdout: "expected 23, got 24",
      stderr: "",
    });
    expect(fromError(failed, 5)).toMatchObject({
      exitCode: 1,
      stdout: "expected 23, got 24",
      crashed: false,
    });
  });

  it("given a dropped connection, when it rejects, then the run counts as a crash", () => {
    expect(fromError(new Error("websocket closed"), 5)).toMatchObject({
      exitCode: -1,
      crashed: true,
    });
  });
});
