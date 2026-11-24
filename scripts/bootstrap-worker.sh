#!/usr/bin/env bash
# Creates a locked-down worker Sprite for one repository and takes its golden checkpoint.
set -euo pipefail
[[ $# -ge 3 && $2 == doorman-w-* && $3 =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] ||
  { echo "usage: $0 <org> <doorman-w-name> <owner/repo> [prepare-command]" >&2; exit 2; }
org=$1 worker=$2 repo=$3 prepare=${4:-true}
dir=/home/sprite/work/${repo#*/}
cd "$(dirname "$0")/.."

sprite list -o "$org" | grep -qx "$worker" ||
  sprite create -o "$org" --skip-console --label doorman-w "$worker"

# The memory cap applies after a restart; every job restores the golden checkpoint, which restarts.
for policy in network privileges resources; do
  sprite api -o "$org" "/v1/sprites/$worker/policy/$policy" -- -sf -X POST \
    -H 'Content-Type: application/json' --data-binary "@policies/worker/$policy.json" >/dev/null
done

sprite exec --no-stdin -o "$org" -s "$worker" -- bash -lc \
  "rm -rf '$dir' && git clone -q --depth 50 'https://github.com/$repo.git' '$dir' && cd '$dir' && $prepare"
sprite checkpoint create -o "$org" -s "$worker" --comment "doorman golden: $repo"
echo "Set repos[].golden to the checkpoint above and repos[].dir to $dir"
