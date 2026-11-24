#!/usr/bin/env bash
# Creates a locked-down worker Sprite for one repository and takes its golden checkpoint.
# Run from a maintainer machine with the `sprite` CLI logged in.
set -euo pipefail

usage() { echo "usage: $0 <org> <worker-name> <owner/repo> [prepare-command]" >&2; exit 2; }
[[ $# -ge 3 ]] || usage
ORG=$1 WORKER=$2 REPO=$3 PREPARE=${4:-}
[[ $WORKER == doorman-w-* ]] || { echo "worker names must start with doorman-w-" >&2; exit 2; }
[[ $REPO =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || usage
DIR="/home/sprite/work/${REPO#*/}"

api() { sprite api -o "$ORG" "$1" -- -s -f -X POST -H 'Content-Type: application/json' --data-binary @- >/dev/null; }

echo "› creating $WORKER"
sprite list -o "$ORG" | grep -qx "$WORKER" || sprite create -o "$ORG" --skip-console --label doorman-w "$WORKER"

echo "› egress: package registries and GitHub only"
api "/v1/sprites/$WORKER/policy/network" <<'JSON'
{"rules":[
 {"domain":"registry.npmjs.org","action":"allow"},
 {"domain":"*.npmjs.org","action":"allow"},
 {"domain":"registry.yarnpkg.com","action":"allow"},
 {"domain":"github.com","action":"allow"},
 {"domain":"codeload.github.com","action":"allow"},
 {"domain":"*.githubusercontent.com","action":"allow"},
 {"domain":"*","action":"deny"}
]}
JSON

echo "› privileges: minimal profile, no new privileges"
api "/v1/sprites/$WORKER/policy/privileges" <<<'{"profile":"minimal","noNewPrivileges":true}'

echo "› memory: 2 GB cap"
api "/v1/sprites/$WORKER/policy/resources" <<<'{"memory":{"limit_mb":2048,"autoscale":false}}'

# The memory cap only applies after a restart, so restore once before installing anything.
echo "› restarting so the memory cap takes effect"
sprite checkpoint create -o "$ORG" -s "$WORKER" --comment "policies applied" >/dev/null
sprite restore -o "$ORG" -s "$WORKER" "$(sprite checkpoint list -o "$ORG" -s "$WORKER" | awk '/policies applied/{print $1; exit}')" >/dev/null
until sprite exec --no-stdin -o "$ORG" -s "$WORKER" -- true 2>/dev/null; do sleep 1; done

echo "› cloning $REPO into $DIR"
sprite exec --no-stdin -o "$ORG" -s "$WORKER" -- bash -lc \
  "rm -rf '$DIR' && mkdir -p \$(dirname '$DIR') && git clone -q --depth 50 'https://github.com/$REPO.git' '$DIR' && git -C '$DIR' config user.email doorman@localhost && git -C '$DIR' config user.name Doorman"

if [[ -n $PREPARE ]]; then
  echo "› preparing: $PREPARE"
  sprite exec --no-stdin -o "$ORG" -s "$WORKER" -- bash -lc "cd '$DIR' && $PREPARE"
fi

echo "› golden checkpoint"
sprite checkpoint create -o "$ORG" -s "$WORKER" --comment "doorman golden: $REPO"
echo "done. Put the checkpoint id above in doorman.config.json (repos[].golden) and dir=$DIR"
