import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Octokit } from "@octokit/rest";
import { type Index, Pinecone } from "@pinecone-database/pinecone";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import type { LanguageModel } from "ai";
import { BoxMemory, createBox } from "./box.js";
import type { Config } from "./config.js";
import { createGitHub } from "./github.js";
import { SpritesWorkers, type Workers } from "./workers.js";

/** The gateway injects the real credentials; SDKs that insist on a key get this instead. */
const NO_KEY = "set-by-sprites-gateway";

export interface Deps {
  config: Config;
  github: Octokit;
  model: LanguageModel;
  workers: Workers;
  /** Optional connectors: each feature that needs one switches off without it. */
  jev?: TypeSafeClient;
  issueIndex?: (namespace: string) => Index;
  box?: BoxMemory;
}

/** Every provider is reached through its Sprites connector, so Doorman holds no provider keys. */
export function createDeps(config: Config): Deps {
  const { github, ollama, typesafe, pinecone, box } = config.connectors;
  const via = (provider: string, id: string) => `${config.gateway}/${provider}/${id}`;
  const writable = new Set(config.repos.filter((r) => r.write).map((r) => r.repo));
  const openai = createOpenAICompatible({ name: "ollama", baseURL: `${via("ollama", ollama)}/v1` });

  return {
    config,
    github: createGitHub(via("github", github), writable),
    model: openai(config.models.reproduce),
    workers: new SpritesWorkers(config.spritesTokenFile, config.workerPrefix),
    ...(typesafe && {
      jev: new TypeSafeClient({ baseURL: via("typesafe", typesafe), apiKey: NO_KEY }),
    }),
    ...(pinecone && {
      issueIndex: (namespace: string) =>
        new Pinecone({ apiKey: NO_KEY }).index({
          host: `${via("pinecone", pinecone.id)}/indexes/${pinecone.index}`,
          namespace,
        }),
    }),
    ...(box && { box: new BoxMemory(createBox(via("box", box.id), NO_KEY), box.folderId) }),
  };
}
