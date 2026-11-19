#!/bin/sh
# Mark dependency and build folders as Dropbox-ignored so each machine keeps its own.
# Run from anywhere; safe to run again. macOS (Dropbox on an external or legacy-mode folder).
set -eu
cd "$(dirname "$0")/.."

ignore() {
  mkdir -p "$1"
  xattr -w com.dropbox.ignored 1 "$1"
}

git ls-files '*package.json' | while read -r manifest; do
  ignore "$(dirname "$manifest")/node_modules"
done
for dir in apps/*/ packages/*/; do
  ignore "${dir}dist"
  ignore "${dir}dist-exe"
done
for dir in release release-mock native/resource-monitor/target apps/desktop/dist-electron \
  apps/desktop/.electron-runtime .electron-runtime .vite-plus .turbo .bun; do
  ignore "$dir"
done
echo "Dropbox will skip node_modules and build output in $(pwd)"
