import { describe, expect, it } from "vitest";
import { issueFromMarkdown } from "../src/agent/triage.js";

describe("issueFromMarkdown", () => {
  it("given a heading and a body, when parsed, then the heading is the title", () => {
    const issue = issueFromMarkdown("# slugify drops accents\n\nTorta de Maçã\n", 7);
    expect(issue).toEqual({
      number: 7,
      title: "slugify drops accents",
      body: "Torta de Maçã",
      labels: [],
    });
  });

  it("given a first line without a heading mark, when parsed, then it is still the title", () => {
    expect(issueFromMarkdown("Plain title\nbody", 1).title).toBe("Plain title");
  });
});
