import { readFileSync } from "node:fs";
import { z } from "zod";

const text = z.string().trim().min(1);
const positive = z.int().positive();

const RepoSchema = z.object({
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/, 'must look like "owner/name"'),
  /** Worker Sprite that holds this repo's golden environment. Must start with the worker prefix. */
  worker: text,
  /** Checkpoint to restore before every job. */
  golden: text,
  /** Working directory inside the worker. */
  dir: text,
  /** Whether Doorman may comment, label and set statuses on this repo. */
  write: z.boolean().default(false),
  /** Trusted command run after checking out a ref, e.g. "npm ci --ignore-scripts". */
  prepare: text.optional(),
});

const ConfigSchema = z
  .object({
    connectors: z.object({ github: text, typesafe: text, ollama: text, pinecone: text, box: text }),
    models: z.object({ reproduce: text }),
    pinecone: z.object({ index: text }),
    box: z.object({ folderId: text }),
    workerPrefix: text,
    spritesTokenFile: text,
    runLog: text,
    repos: z.array(RepoSchema).min(1),
    limits: z
      .object({
        stepsPerJob: positive.default(20),
        commandTimeoutMs: positive.default(120_000),
        verifyRuns: positive.default(3),
      })
      .prefault({}),
  })
  .superRefine((config, ctx) => {
    for (const [i, r] of config.repos.entries()) {
      if (!r.worker.startsWith(config.workerPrefix)) {
        ctx.addIssue({
          code: "custom",
          path: ["repos", i, "worker"],
          message: `must start with "${config.workerPrefix}"`,
        });
      }
    }
  });

export type Config = z.infer<typeof ConfigSchema>;
export type RepoConfig = z.infer<typeof RepoSchema>;

export class ConfigError extends Error {}

export function parseConfig(raw: unknown): Config {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) throw new ConfigError(`invalid config\n${z.prettifyError(result.error)}`);
  return result.data;
}

export function loadConfig(path: string): Config {
  return parseConfig(JSON.parse(readFileSync(path, "utf8")));
}

export function repoConfig(config: Config, repo: string): RepoConfig {
  const found = config.repos.find((r) => r.repo === repo);
  if (!found) throw new ConfigError(`repository ${repo} is not configured`);
  return found;
}
