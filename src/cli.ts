#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { checkPr } from "./agent/prcheck.js";
import { fetchIssue, issueFromMarkdown, triageIssue } from "./agent/triage.js";
import { createDeps } from "./clients.js";
import { loadConfig, repoConfig } from "./config.js";
import { commitBefore } from "./github.js";

const USAGE = `Usage:
  doorman triage <owner/repo> <issue> [--dry-run] [--shadow] [--issue-file <file.md>] [--config <file>]
  doorman check-pr <owner/repo> <pr> [--dry-run] [--config <file>]

  --dry-run      print the report instead of posting it
  --shadow       read-only replay of a past issue on the commit it was reported against
  --issue-file   triage this Markdown report (first line is the title) instead of
                 fetching <issue>; nothing is written anywhere (eval corpus)
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
      "issue-file": { type: "string" },
      shadow: { type: "boolean", default: false },
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
  const file = values["issue-file"];
  const write = !values["dry-run"] && !file && !values.shadow;

  if (command === "triage") {
    const issue = file
      ? issueFromMarkdown(readFileSync(file, "utf8"), number)
      : await fetchIssue(deps.github, repo.repo, number);
    const mode = file ? "eval" : values.shadow ? "shadow" : "demo";
    const ref =
      mode === "shadow" && issue.createdAt
        ? await commitBefore(deps.github, repo.repo, issue.createdAt)
        : undefined;
    const result = await triageIssue(deps, repo, issue, { mode, write, ...(ref ? { ref } : {}) });
    console.log(result.report);
    emit({
      level: "info",
      event: "triage",
      ...(file ? { case: basename(file) } : {}),
      ...(ref ? { commit: ref } : {}),
      ...result.record,
    });
    return 0;
  }
  if (command === "check-pr") {
    const result = await checkPr(deps, repo, number, { write });
    console.log(result.report);
    emit({
      level: "info",
      event: "check-pr",
      description: result.description,
      ...result.record,
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
