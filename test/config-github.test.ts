import type { BoxClient } from "box-node-sdk";
import { describe, expect, it } from "vitest";
import { BoxMemory, ProtectedFileError } from "../src/box.js";
import { ConfigError, parseConfig } from "../src/config.js";
import { createGitHub, WriteNotAllowedError } from "../src/github.js";

const valid = {
  connectors: { github: "g", typesafe: "t", ollama: "o", pinecone: "p", box: "b" },
  models: { reproduce: "gpt-oss:120b" },
  pinecone: { index: "doorman-issues" },
  box: { folderId: "1" },
  workerPrefix: "doorman-w-",
  spritesTokenFile: "/tmp/token",
  runLog: "/tmp/runs.jsonl",
  repos: [
    { repo: "acme/widgets", worker: "doorman-w-widgets", golden: "v1", dir: "/w", write: true },
  ],
};

describe("parseConfig", () => {
  it("given a valid config, when parsed, then limits get defaults", () => {
    expect(parseConfig(valid).limits).toEqual({
      stepsPerJob: 20,
      commandTimeoutMs: 120_000,
      verifyRuns: 3,
    });
  });

  it("given a repo without write, when parsed, then it is read-only", () => {
    const { write: _, ...readOnly } = valid.repos[0] as (typeof valid.repos)[number];
    expect(parseConfig({ ...valid, repos: [readOnly] }).repos[0]?.write).toBe(false);
  });

  it("given a worker outside the prefix, when parsed, then it is rejected", () => {
    const bad = { ...valid, repos: [{ ...valid.repos[0], worker: "doorman-home" }] };
    expect(() => parseConfig(bad)).toThrow(ConfigError);
  });

  it("given a missing connector, when parsed, then the error names it", () => {
    const bad = { ...valid, connectors: { ...valid.connectors, typesafe: "" } };
    expect(() => parseConfig(bad)).toThrow(/connectors\.typesafe/);
  });
});

describe("GitHub write guard", () => {
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input) => {
    requests.push(String(input));
    return Response.json({}, { status: 201 });
  };
  const github = createGitHub("https://gateway.test/github/c", new Set(["acme/widgets"]), fetch);

  it("given a writable repo, when commenting, then the request is sent", async () => {
    await github.rest.issues.createComment({
      owner: "acme",
      repo: "widgets",
      issue_number: 1,
      body: "hi",
    });
    expect(requests.at(-1)).toBe(
      "https://gateway.test/github/c/repos/acme/widgets/issues/1/comments",
    );
  });

  it("given a read-only repo, when commenting, then nothing is sent", async () => {
    const before = requests.length;
    await expect(
      github.rest.issues.createComment({
        owner: "someone",
        repo: "else",
        issue_number: 1,
        body: "hi",
      }),
    ).rejects.toBeInstanceOf(WriteNotAllowedError);
    expect(requests).toHaveLength(before);
  });

  it("given a read-only repo, when reading, then the request is sent", async () => {
    await github.rest.issues.get({ owner: "someone", repo: "else", issue_number: 1 });
    expect(requests.at(-1)).toContain("/repos/someone/else/issues/1");
  });
});

describe("Box memory", () => {
  it.each(["env.md", "quirks.md", "policy.md"])(
    "given the maintainer-owned %s, when Doorman writes it, then the write is refused",
    async (name) => {
      const memory = new BoxMemory({} as BoxClient, "root");
      await expect(memory.write("folder", name, "poisoned")).rejects.toBeInstanceOf(
        ProtectedFileError,
      );
    },
  );
});
