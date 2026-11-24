#!/usr/bin/env bash
# Builds Doorman, installs it on the home Sprite and stores a restricted Sprites token there.
# Run from a maintainer machine with the `sprite` CLI logged in.
set -euo pipefail

[[ $# -eq 2 ]] || { echo "usage: $0 <org> <home-sprite>" >&2; exit 2; }
ORG=$1 HOME_SPRITE=$2
cd "$(dirname "$0")/.."

write_file() { # write_file <remote-path> <mode>  (content on stdin)
  sprite api -o "$ORG" "/v1/sprites/$HOME_SPRITE/fs/write?path=$1&mode=$2&mkdirParents=true" \
    -- -s -f -X PUT -H 'Content-Type: application/octet-stream' --data-binary @- >/dev/null
}

echo "› building"
npm ci --no-audit --no-fund >/dev/null && npm run build >/dev/null

echo "› creating $HOME_SPRITE if needed"
sprite list -o "$ORG" | grep -qx "$HOME_SPRITE" || sprite create -o "$ORG" --skip-console --label doorman-home "$HOME_SPRITE"

echo "› uploading"
tar -czf - dist package.json package-lock.json | write_file /home/sprite/doorman/release.tgz 0644
sprite exec --no-stdin -o "$ORG" -s "$HOME_SPRITE" -- bash -lc '
  set -e; cd ~/doorman && tar -xzf release.tgz && rm release.tgz
  npm ci --omit=dev --no-audit --no-fund >/dev/null
  mkdir -p ~/.local/bin && ln -sf ~/doorman/dist/cli.js ~/.local/bin/doorman && chmod +x dist/cli.js'

if [[ -t 0 ]]; then
  read -rsp "Paste the Sprites token restricted to doorman-w- (input hidden, Enter to keep the current one): " TOKEN; echo
else
  read -r TOKEN || true
fi
if [[ -n ${TOKEN:-} ]]; then
  printf '%s' "$TOKEN" | write_file /home/sprite/.config/doorman/sprites-token 0600
  unset TOKEN
  echo "› token stored with mode 0600"
fi

echo "› egress: Sprites API and GitHub tarballs only"
sprite api -o "$ORG" "/v1/sprites/$HOME_SPRITE/policy/network" -- -s -f -X POST \
  -H 'Content-Type: application/json' --data-binary @- >/dev/null <<'JSON'
{"rules":[
 {"domain":"api.sprites.dev","action":"allow"},
 {"domain":"codeload.github.com","action":"allow"},
 {"domain":"registry.npmjs.org","action":"allow"},
 {"domain":"*","action":"deny"}
]}
JSON
echo "done. Copy doorman.config.example.json to ~/doorman/doorman.config.json on $HOME_SPRITE and fill it in."
