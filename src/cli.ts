#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkPr } from "./agent/prcheck.js";
import { type Deps, triageIssue } from "./agent/triage.js";
import { BoxMemory } from "./box.js";
import { loadConfig, repoConfig } from "./config.js";
import { GitHub } from "./github.js";
import { createHttpClient } from "./http.js";
import { Jev } from "./jev.js";
import { Ollama } from "./ollama.js";
import { IssueMemory } from "./pinecone.js";
import { SpritesWorkers } from "./workers.js";

const USAGE = `Usage:
  doorman triage <owner/repo> <issue> [--dry-run] [--config <file>]
  doorman check-pr <owner/repo> <pr> [--dry-run] [--config <file>]

  --dry-run   print the report instead of posting it
  --config    defaults to ./doorman.config.json`;

function deps(configPath: string): Deps {
  const config = loadConfig(configPath);
  const http = createHttpClient();
  const writable = new Set(config.repos.filter((r) => r.write).map((r) => r.repo));
  return {
    config,
    github: new GitHub(http, config.connectors.github, writable),
    jev: new Jev(http, config.connectors.typesafe),
    ollama: new Ollama(http, config.connectors.ollama),
    issues: new IssueMemory(http, config.connectors.pinecone, config.pinecone.index),
    box: new BoxMemory(http, config.connectors.box, config.box.folderId),
    workers: new SpritesWorkers(config.spritesTokenFile, config.workerPrefix),
  };
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      config: { type: "string", default: "doorman.config.json" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, repoName, ref] = positionals;
  const number = Number(ref);
  if (values.help || !command || !repoName || !Number.isInteger(number) || number <= 0) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }
  const d = deps(values.config);
  const repo = repoConfig(d.config, repoName);
  const write = !values["dry-run"];

  if (command === "triage") {
    const result = await triageIssue(d, repo, number, { mode: "demo", write });
    console.log(result.report);
    console.error(`\nverdict: ${result.verdict} · ${(result.record.wallMs / 1000).toFixed(1)}s`);
    return 0;
  }
  if (command === "check-pr") {
    const result = await checkPr(d, repo, number, { write });
    console.log(result.report);
    console.error(`\nstatus: ${result.state} · ${result.description}`);
    return result.state === "success" ? 0 : 1;
  }
  console.log(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(`doorman: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  },
);
