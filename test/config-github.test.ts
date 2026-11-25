import type { BoxClient } from "box-node-sdk";
import { describe, expect, it } from "vitest";
import { BoxMemory, ProtectedFileError } from "../src/box.js";
import { ConfigError, parseConfig } from "../src/config.js";
import { commitBefore, createGitHub, upsertComment, WriteNotAllowedError } from "../src/github.js";

const valid = {
  connectors: { github: "g", ollama: "o" },
  models: { reproduce: "gpt-oss:120b" },
  workerPrefix: "doorman-w-",
  spritesTokenFile: "/tmp/token",
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

  it("given a missing required connector, when parsed, then the error names it", () => {
    const bad = { ...valid, connectors: { github: "g" } };
    expect(() => parseConfig(bad)).toThrow(/connectors\.ollama/);
  });

  it("given only GitHub and Ollama, when parsed, then the optional connectors stay off", () => {
    const { typesafe, pinecone, box } = parseConfig(valid).connectors;
    expect([typesafe, pinecone, box]).toEqual([undefined, undefined, undefined]);
  });

  it("given Pinecone without an index name, when parsed, then the default index is used", () => {
    const withPinecone = { ...valid, connectors: { ...valid.connectors, pinecone: { id: "p" } } };
    expect(parseConfig(withPinecone).connectors.pinecone?.index).toBe("doorman-issues");
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

describe("upsertComment", () => {
  const run = async (existing: { id: number; body: string; author_association: string }[]) => {
    const calls: string[] = [];
    const fetch: typeof globalThis.fetch = async (input, init) => {
      calls.push(
        `${init?.method ?? "GET"} ${String(input).replace("https://gateway.test/github/c", "")}`,
      );
      return Response.json(init?.method === "GET" || !init?.method ? existing : {});
    };
    const github = createGitHub("https://gateway.test/github/c", new Set(["acme/widgets"]), fetch);
    await upsertComment(github, { owner: "acme", repo: "widgets", issue_number: 4 }, "report");
    return calls.at(-1);
  };

  it.each([
    ["no earlier report", [], "POST /repos/acme/widgets/issues/4/comments"],
    [
      "an earlier report by the owner",
      [{ id: 9, body: "<!-- doorman -->\nold", author_association: "OWNER" }],
      "PATCH /repos/acme/widgets/issues/comments/9",
    ],
    [
      "a stranger's comment carrying the marker",
      [{ id: 9, body: "<!-- doorman -->\nfake", author_association: "NONE" }],
      "POST /repos/acme/widgets/issues/4/comments",
    ],
  ])("given %s, when Doorman reports, then it sends %s", async (_case, existing, expected) => {
    expect(await run(existing)).toBe(expected);
  });
});

describe("commitBefore", () => {
  it("given a report date, when asked, then it returns the last commit before it", async () => {
    let url = "";
    const fetch: typeof globalThis.fetch = async (input) => {
      url = String(input);
      return Response.json([{ sha: "abc123" }]);
    };
    const github = createGitHub("https://gateway.test/github/c", new Set(), fetch);
    const sha = await commitBefore(github, "acme/widgets", "2025-03-26T10:00:00Z");
    expect({ sha, until: new URL(url).searchParams.get("until") }).toEqual({
      sha: "abc123",
      until: "2025-03-26T10:00:00Z",
    });
  });
});
