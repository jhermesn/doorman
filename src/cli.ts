#!/usr/bin/env node
import { homedir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { checkPr } from "./agent/prcheck.js";
import { triageIssue } from "./agent/triage.js";
import { createDeps } from "./clients.js";
import { loadConfig, repoConfig } from "./config.js";

const USAGE = `Usage:
  doorman triage <owner/repo> <issue> [--dry-run] [--config <file>]
  doorman check-pr <owner/repo> <pr> [--dry-run] [--config <file>]

  --dry-run   print the report instead of posting it
  --config    defaults to $DOORMAN_CONFIG, then ~/.config/doorman/config.json

  The report goes to stdout; one JSON event per run goes to stderr.`;

/** Logs are an event stream on stderr (twelve-factor XI); whoever runs Doorman routes them. */
function emit(event: Record<string, unknown>): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), service: "doorman", ...event }));
}

async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      "dry-run": { type: "boolean", default: false },
      config: {
        type: "string",
        default: process.env.DOORMAN_CONFIG ?? join(homedir(), ".config/doorman/config.json"),
      },
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
    emit({ level: "info", event: "triage", ...result.record });
    return 0;
  }
  if (command === "check-pr") {
    const result = await checkPr(deps, repo, number, { write });
    console.log(result.report);
    emit({
      level: "info",
      event: "check-pr",
      repo: repo.repo,
      ref: number,
      issue: result.issue ?? null,
      state: result.state,
      description: result.description,
      base: result.base?.exitCodes ?? [],
      head: result.head?.exitCodes ?? [],
    });
    // Only a disproven fix claim fails the job; PRs that claim nothing have nothing to check.
    return result.state === "failure" ? 1 : 0;
  }
  console.log(USAGE);
  return 2;
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    emit({ level: "error", message: error instanceof Error ? error.message : String(error) });
    process.exit(1);
  },
);
