#!/bin/sh
# Deploys the phone relay with the wrangler on PATH (or $WRANGLER), then checks it answers.
set -eu
cd "$(dirname "$0")/.."
WRANGLER="${WRANGLER:-wrangler}"
"$WRANGLER" deploy
URL="${PHONE_RELAY_URL:-}"
if [ -n "$URL" ]; then
  curl -fsS "$URL/__agentdock/health"
  echo
fi
