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
  jev: TypeSafeClient;
  model: LanguageModel;
  issueIndex: (namespace: string) => Index;
  box: BoxMemory;
  workers: Workers;
}

/** Every provider is reached through its Sprites connector, so Doorman holds no provider keys. */
export function createDeps(config: Config): Deps {
  const via = (provider: keyof Config["connectors"]) =>
    `${config.gateway}/${provider}/${config.connectors[provider]}`;
  const pinecone = new Pinecone({ apiKey: NO_KEY });
  const writable = new Set(config.repos.filter((r) => r.write).map((r) => r.repo));
  const ollama = createOpenAICompatible({ name: "ollama", baseURL: `${via("ollama")}/v1` });

  return {
    config,
    github: createGitHub(via("github"), writable),
    jev: new TypeSafeClient({ baseURL: via("typesafe"), apiKey: NO_KEY }),
    model: ollama(config.models.reproduce),
    issueIndex: (namespace) =>
      pinecone.index({ host: `${via("pinecone")}/indexes/${config.pinecone.index}`, namespace }),
    box: new BoxMemory(createBox(via("box"), NO_KEY), config.box.folderId),
    workers: new SpritesWorkers(config.spritesTokenFile, config.workerPrefix),
  };
}
