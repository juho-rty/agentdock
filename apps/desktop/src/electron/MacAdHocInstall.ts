// @effect-diagnostics nodeBuiltinImport:off -- The swap helper must outlive the app, so it runs outside the Effect runtime.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

// Squirrel.Mac rejects every update to an ad-hoc signed build (no stable designated requirement).
// For those builds a detached helper waits for the app to exit, unpacks the zip electron-updater
// already downloaded and verified, swaps the bundle, and relaunches it.

/** `/X/AgentDock.app/Contents/MacOS/AgentDock` → `/X/AgentDock.app`, or null outside a bundle. */
export function appBundlePathFromExecPath(execPath: string): string | null {
  const match = /^(.+\.app)\/Contents\/MacOS\/[^/]+$/.exec(execPath);
  return match?.[1] ?? null;
}

/** True when `codesign -dv` reports an ad-hoc signature (or no signature at all). */
export function isAdHocSignature(codesignOutput: string): boolean {
  return (
    /^Signature=adhoc$/m.test(codesignOutput) || /code object is not signed/.test(codesignOutput)
  );
}

function isAdHocSignedBundle(bundlePath: string): boolean {
  const result = NodeChildProcess.spawnSync("/usr/bin/codesign", ["-dv", bundlePath], {
    encoding: "utf8",
  });
  return isAdHocSignature(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
}

/**
 * The helper: $1 = pid to wait for, $2 = update zip, $3 = app bundle to replace. On any failure it
 * puts the old bundle back and relaunches it, so a bad update never leaves the app missing.
 */
export const MAC_SWAP_SCRIPT = `#!/bin/bash
set -u
pid="$1"; zip="$2"; app="$3"
open() { "\${AGENTDOCK_SWAP_OPEN:-/usr/bin/open}" "$@"; }
for _ in $(seq 1 600); do kill -0 "$pid" 2>/dev/null || break; sleep 0.2; done
if kill -0 "$pid" 2>/dev/null; then exit 1; fi
work="$(mktemp -d "\${TMPDIR:-/tmp}/agentdock-update.XXXXXX")" || { open "$app"; exit 1; }
cleanup() { rm -rf "$work"; rm -f "$0"; rmdir "$(dirname "$0")" 2>/dev/null; }
trap cleanup EXIT
if ! /usr/bin/ditto -x -k "$zip" "$work"; then open "$app"; exit 1; fi
new="$(/usr/bin/find "$work" -maxdepth 1 -name '*.app' -type d | head -n 1)"
if [ -z "$new" ]; then open "$app"; exit 1; fi
/usr/bin/xattr -dr com.apple.quarantine "$new" 2>/dev/null
backup="$app.previous-$$"
if ! mv "$app" "$backup"; then open "$app"; exit 1; fi
if ! mv "$new" "$app"; then mv "$backup" "$app"; open "$app"; exit 1; fi
rm -rf "$backup"
open "$app"
`;

/**
 * Starts the swap helper when this is an ad-hoc signed macOS bundle and the update zip exists.
 * Returns false (and starts nothing) otherwise, so the caller falls back to Squirrel.Mac.
 */
export function startMacAdHocInstall(input: {
  readonly platform: NodeJS.Platform;
  readonly execPath: string;
  readonly pid: number;
  readonly downloadedFile: string | null;
}): boolean {
  if (input.platform !== "darwin" || input.downloadedFile === null) return false;
  const bundlePath = appBundlePathFromExecPath(input.execPath);
  if (bundlePath === null || !NodeFS.existsSync(input.downloadedFile)) return false;
  if (!isAdHocSignedBundle(bundlePath)) return false;
  NodeFS.accessSync(NodePath.dirname(bundlePath), NodeFS.constants.W_OK);
  const scriptDir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "agentdock-update-"));
  const scriptPath = NodePath.join(scriptDir, "swap.sh");
  NodeFS.writeFileSync(scriptPath, MAC_SWAP_SCRIPT, { mode: 0o700 });
  const child = NodeChildProcess.spawn(
    "/bin/bash",
    [scriptPath, String(input.pid), input.downloadedFile, bundlePath],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  return true;
}
