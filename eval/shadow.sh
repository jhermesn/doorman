#!/usr/bin/env bash
# Replays past issues read-only with `doorman triage --shadow` (each on the commit it was
# reported against) and appends one JSON event per issue to the results file.
set -euo pipefail
[[ $# -ge 3 ]] || { echo "usage: $0 <owner/repo> <results.jsonl> <issue>..." >&2; exit 2; }
repo=$1 out=$2
shift 2
for n in "$@"; do
  if ! doorman triage "$repo" "$n" --shadow 2>>"$out" >/dev/null; then
    printf '{"repo":"%s","ref":%s,"verdict":"error"}\n' "$repo" "$n" >>"$out"
  fi
done
