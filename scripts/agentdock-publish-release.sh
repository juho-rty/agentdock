#!/usr/bin/env bash
# Copy an AgentDock release from the private source repo to the public
# update feed (juho-rty/agentdock-releases) that installed apps check, and
# refresh the installers in Dropbox/Apps/AgentDock-installers.
# Usage: scripts/agentdock-publish-release.sh v0.1.12
set -euo pipefail
tag="${1:?usage: $0 vX.Y.Z}"
src=juho-rty/agentdock
dst=juho-rty/agentdock-releases
installers="$(cd "$(dirname "$0")/../.." && pwd)/AgentDock-installers"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
gh release download "$tag" -R "$src" -D "$work"
if gh release view "$tag" -R "$dst" >/dev/null 2>&1; then
  gh release upload "$tag" "$work"/* -R "$dst" --clobber
else
  gh release create "$tag" "$work"/* -R "$dst" \
    --title "AgentDock $tag" --notes "Installers for AgentDock $tag."
fi

if [ -d "$installers" ]; then
  rm -f "$installers"/AgentDock-*.dmg "$installers"/AgentDock-*.exe
  cp "$work"/AgentDock-*.dmg "$work"/AgentDock-*.exe "$installers"/
fi
echo "Published $tag to $dst"
