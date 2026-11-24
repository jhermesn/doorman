import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

// Synthetic, obviously fake values assembled at runtime so secret scanners don't flag the fixtures.
const fake = {
  github: `ghp_${"x".repeat(36)}`,
  pinecone: `pcsk_${"y".repeat(30)}`,
  sprites: `acme/1/${"0".repeat(32)}/${"f".repeat(64)}`,
  aws: `AKIA${"Z".repeat(16)}`,
};

describe("redact", () => {
  it.each([
    [`token ${fake.github}`, "<github-token>"],
    [`key=${fake.pinecone}`, "<pinecone-key>"],
    [fake.sprites, "<sprites-token>"],
    [`Authorization: Bearer ${"b".repeat(24)}`, "Bearer <redacted>"],
    [`NPM_TOKEN=${"n".repeat(12)}`, "NPM_TOKEN=<redacted>"],
    [fake.aws, "<aws-access-key>"],
  ])("given a credential-shaped string, when redacted, then it becomes %s", (input, expected) => {
    expect(redact(input)).toContain(expected);
  });

  it("given text without secrets, when redacted, then it is unchanged", () => {
    const text = "TypeError: Cannot read properties of undefined (reading 'getHours')";
    expect(redact(text)).toBe(text);
  });
});
