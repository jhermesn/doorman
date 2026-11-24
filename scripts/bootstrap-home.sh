#!/usr/bin/env bash
# Installs Doorman on the home Sprite, stores its Sprites token and locks its egress.
set -euo pipefail
[[ $# -ge 2 ]] || { echo "usage: $0 <org> <home-sprite> [npm-source]" >&2; exit 2; }
org=$1 home=$2 source=${3:-github:jhermesn/doorman}
cd "$(dirname "$0")/.."

sprite list -o "$org" | grep -qx "$home" ||
  sprite create -o "$org" --skip-console --label doorman-home "$home"
sprite exec --no-stdin -o "$org" -s "$home" -- bash -lc "npm install --global --prefix ~/.local '$source'"

# The token goes through stdin to the filesystem API, so it never lands in argv or on disk here.
read -rsp "Sprites token restricted to doorman-w- (Enter keeps the current one): " token || true
echo
if [[ -n $token ]]; then
  printf '%s' "$token" | sprite api -o "$org" \
    "/v1/sprites/$home/fs/write?path=/home/sprite/.config/doorman/sprites-token&mode=0600&mkdirParents=true" \
    -- -sf -X PUT -H 'Content-Type: application/octet-stream' --data-binary @- >/dev/null
fi

sprite api -o "$org" "/v1/sprites/$home/policy/network" -- -sf -X POST \
  -H 'Content-Type: application/json' --data-binary @policies/home/network.json >/dev/null
echo "Next: sprite file push -o $org -s $home doorman.config.json /home/sprite/.config/doorman/config.json"
