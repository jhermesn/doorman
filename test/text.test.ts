import { describe, expect, it } from "vitest";
import { fill } from "../src/text.js";

describe("fill", () => {
  it.each([
    [
      "given known placeholders, when filled, then each is replaced",
      "#{issue} in {repo}",
      { issue: 7, repo: "a/b" },
      "#7 in a/b",
    ],
    ["given an unknown placeholder, when filled, then it is kept", "{missing}", {}, "{missing}"],
    [
      "given a value that looks like a placeholder, when filled, then it is not expanded again",
      "{a}",
      { a: "{b}", b: "x" },
      "{b}",
    ],
  ])("%s", (_name, template, values, expected) => {
    expect(fill(template, values)).toBe(expected);
  });
});
