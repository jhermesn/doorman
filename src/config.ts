import { readFileSync } from "node:fs";

export const GATEWAY = "https://api.sprites.dev/v1/gateway";

export interface RepoConfig {
  /** "owner/name" */
  repo: string;
  /** Worker Sprite that holds this repo's golden environment. Must start with the worker prefix. */
  worker: string;
  /** Checkpoint to restore before every job. */
  golden: string;
  /** Working directory inside the worker. */
  dir: string;
  /** Whether Doorman may comment, label and set statuses on this repo. */
  write: boolean;
  /** Trusted command run after checking out a ref, e.g. "npm ci --prefer-offline". */
  prepare?: string;
}

export interface Config {
  connectors: {
    github: string;
    typesafe: string;
    ollama: string;
    pinecone: string;
    box: string;
  };
  models: { reproduce: string };
  pinecone: { index: string };
  box: { folderId: string };
  workerPrefix: string;
  spritesTokenFile: string;
  runLog: string;
  repos: RepoConfig[];
  limits: { stepsPerJob: number; commandTimeoutMs: number; verifyRuns: number };
}

export class ConfigError extends Error {}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ConfigError(`config: "${path}" must be a non-empty string`);
  }
  return value;
}

export function parseConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("config: expected an object");
  const c = raw as Config;
  for (const key of ["github", "typesafe", "ollama", "pinecone", "box"] as const) {
    requireString(c.connectors?.[key], `connectors.${key}`);
  }
  requireString(c.models?.reproduce, "models.reproduce");
  requireString(c.pinecone?.index, "pinecone.index");
  requireString(c.box?.folderId, "box.folderId");
  const prefix = requireString(c.workerPrefix, "workerPrefix");
  requireString(c.spritesTokenFile, "spritesTokenFile");
  requireString(c.runLog, "runLog");
  if (!Array.isArray(c.repos) || c.repos.length === 0) {
    throw new ConfigError('config: "repos" must list at least one repository');
  }
  for (const [i, r] of c.repos.entries()) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(requireString(r.repo, `repos[${i}].repo`))) {
      throw new ConfigError(`config: repos[${i}].repo must look like "owner/name"`);
    }
    if (!requireString(r.worker, `repos[${i}].worker`).startsWith(prefix)) {
      throw new ConfigError(`config: repos[${i}].worker must start with "${prefix}"`);
    }
    requireString(r.golden, `repos[${i}].golden`);
    requireString(r.dir, `repos[${i}].dir`);
  }
  return {
    ...c,
    limits: {
      stepsPerJob: 20,
      commandTimeoutMs: 120_000,
      verifyRuns: 3,
      ...(c.limits as Partial<Config["limits"]> | undefined),
    },
  };
}

export function loadConfig(path: string): Config {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function repoConfig(config: Config, repo: string): RepoConfig {
  const found = config.repos.find((r) => r.repo === repo);
  if (!found) throw new ConfigError(`repository ${repo} is not configured`);
  return found;
}
