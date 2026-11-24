import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "../src/config.js";
import { GitHub, WriteNotAllowedError } from "../src/github.js";
import type { HttpClient } from "../src/http.js";

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

  it("given a worker outside the prefix, when parsed, then it is rejected", () => {
    const bad = { ...valid, repos: [{ ...valid.repos[0], worker: "doorman-home" }] };
    expect(() => parseConfig(bad)).toThrow(ConfigError);
  });

  it("given a missing connector, when parsed, then it is rejected", () => {
    const bad = { ...valid, connectors: { ...valid.connectors, typesafe: "" } };
    expect(() => parseConfig(bad)).toThrow(/connectors.typesafe/);
  });
});

describe("GitHub write guard", () => {
  const requests: string[] = [];
  const http: HttpClient = {
    request: async (url) => {
      requests.push(url);
      return new Response("{}");
    },
    json: async () => ({}) as never,
  };
  const github = new GitHub(http, "conn", new Set(["acme/widgets"]));

  it("given a writable repo, when commenting, then the request is sent", async () => {
    await github.comment("acme/widgets", 1, "hi");
    expect(requests.at(-1)).toContain("/repos/acme/widgets/issues/1/comments");
  });

  it("given a read-only repo, when commenting, then nothing is sent", async () => {
    const before = requests.length;
    await expect(github.comment("someone/else", 1, "hi")).rejects.toBeInstanceOf(
      WriteNotAllowedError,
    );
    expect(requests).toHaveLength(before);
  });
});
