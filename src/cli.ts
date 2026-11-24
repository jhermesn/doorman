#!/usr/bin/env node
import { parseArgs } from "node:util";
import { checkPr } from "./agent/prcheck.js";
import { triageIssue } from "./agent/triage.js";
import { createDeps } from "./clients.js";
import { loadConfig, repoConfig } from "./config.js";

const USAGE = `Usage:
  doorman triage <owner/repo> <issue> [--dry-run] [--config <file>]
  doorman check-pr <owner/repo> <pr> [--dry-run] [--config <file>]

  --dry-run   print the report instead of posting it
  --config    defaults to ./doorman.config.json`;

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
  const deps = createDeps(loadConfig(values.config));
  const repo = repoConfig(deps.config, repoName);
  const write = !values["dry-run"];

  if (command === "triage") {
    const result = await triageIssue(deps, repo, number, { mode: "demo", write });
    console.log(result.report);
    console.error(`\nverdict: ${result.verdict} · ${(result.record.wallMs / 1000).toFixed(1)}s`);
    return 0;
  }
  if (command === "check-pr") {
    const result = await checkPr(deps, repo, number, { write });
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
