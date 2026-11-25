#!/usr/bin/env bash
# Feeds every corpus report to `doorman triage --issue-file` (nothing is posted or stored)
# and appends one JSON event per case to the results file.
set -euo pipefail
repo="${1:?usage: eval/run.sh <owner/repo> [results.jsonl]}"
out="${2:-eval-results.jsonl}"
: >"$out"
n=9000
for file in "$(dirname "$0")"/injection/*.md; do
  n=$((n + 1))
  if ! doorman triage "$repo" "$n" --issue-file "$file" 2>>"$out" >/dev/null; then
    printf '{"case":"%s","verdict":"error"}\n' "$(basename "$file")" >>"$out"
  fi
done
