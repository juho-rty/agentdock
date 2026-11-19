// @effect-diagnostics nodeBuiltinImport:off -- This platform boundary asks Finder or File Explorer for its folder with Node.

import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";

const FINDER_TIMEOUT_MS = 4_000;
// Add-Type compiles C# on every run, which takes a few seconds on a cold PowerShell.
const EXPLORER_TIMEOUT_MS = 8_000;

const FINDER_SCRIPT =
  'tell application "Finder" to if (count of Finder windows) > 0 then POSIX path of (target of front Finder window as alias)';

const EXPLORER_SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -Namespace AgentDock -Name Z -MemberDefinition @'
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
'@
$z = @{}; $i = 0; $h = [AgentDock.Z]::GetTopWindow([IntPtr]::Zero)
while ($h -ne [IntPtr]::Zero -and $i -lt 6000) { $z[[int64]$h] = $i; $i++; $h = [AgentDock.Z]::GetWindow($h, 2) }
$out = @()
foreach ($w in (New-Object -ComObject Shell.Application).Windows()) {
  try {
    if ($w.FullName -notmatch 'explorer\.exe$') { continue }
    $hw = [int64]$w.HWND
    $sb = New-Object Text.StringBuilder 512
    [void][AgentDock.Z]::GetWindowText([IntPtr]$hw, $sb, 512)
    $zi = 999999; if ($z.ContainsKey($hw)) { $zi = $z[$hw] }
    $out += [pscustomobject]@{ hwnd = $hw; z = $zi; title = $sb.ToString(); name = [string]$w.LocationName; path = [string]$w.Document.Folder.Self.Path; min = [bool][AgentDock.Z]::IsIconic([IntPtr]$hw) }
  } catch {}
}
ConvertTo-Json -Compress -InputObject @($out)
`;

export interface ExplorerWindowEntry {
  readonly hwnd?: unknown;
  readonly z?: unknown;
  readonly title?: unknown;
  readonly name?: unknown;
  readonly path?: unknown;
  readonly min?: unknown;
}

type PathExists = (path: string) => boolean;

const isDirectory: PathExists = (path) => {
  try {
    return NodeFS.statSync(path).isDirectory();
  } catch {
    return false;
  }
};

export function normalizeFinderOutput(output: string, exists: PathExists = isDirectory) {
  let path = output.trim();
  if (path.length === 0) return null;
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return exists(path) ? path : null;
}

/** Drive paths and UNC shares; shell namespaces such as "::{…}" or "This PC" are not folders. */
function isExplorerFolderPath(path: string) {
  return /^[A-Za-z]:\\/.test(path) || /^\\\\[^\\?.][^\\]*\\[^\\]+/.test(path);
}

export function parseExplorerWindows(output: string): ReadonlyArray<ExplorerWindowEntry> {
  try {
    const parsed: unknown = JSON.parse(output.trim() || "[]");
    if (Array.isArray(parsed)) return parsed;
    return parsed !== null && typeof parsed === "object" ? [parsed] : [];
  } catch {
    return [];
  }
}

/**
 * Windows 11 tabs share their window's hwnd; the active tab is the one whose name starts the title.
 * Visible windows win over minimized ones, then the lowest z-order (front-most) wins.
 */
export function pickExplorerFolder(
  entries: ReadonlyArray<ExplorerWindowEntry>,
  exists: PathExists = isDirectory,
) {
  const byWindow = new Map<string, { entry: ExplorerWindowEntry; active: boolean }>();
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object" || entry.hwnd == null) continue;
    const key = String(entry.hwnd);
    const name = typeof entry.name === "string" ? entry.name : "";
    const title = typeof entry.title === "string" ? entry.title : "";
    const active = name.length > 0 && title.startsWith(name);
    const current = byWindow.get(key);
    if (!current || (active && !current.active)) byWindow.set(key, { entry, active });
  }
  const ordered = [...byWindow.values()]
    .map(({ entry }) => entry)
    .toSorted(
      (a, b) =>
        (a.min === true ? 1 : 0) - (b.min === true ? 1 : 0) ||
        (Number(a.z) || 0) - (Number(b.z) || 0),
    );
  for (const entry of ordered) {
    let path = typeof entry.path === "string" ? entry.path : "";
    if (!isExplorerFolderPath(path)) continue;
    if (path.length > 3) path = path.replace(/\\+$/, "");
    if (exists(path)) return path;
  }
  return null;
}

function run(command: string, args: ReadonlyArray<string>, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    NodeChildProcess.execFile(
      command,
      [...args],
      { timeout, maxBuffer: 1024 * 1024, windowsHide: true },
      (error, stdout) => resolve(error ? "" : String(stdout)),
    );
  });
}

/** The folder of the front Finder (macOS) or File Explorer (Windows) window, or null. Never rejects. */
export async function readFileManagerFolder(platform: NodeJS.Platform): Promise<string | null> {
  if (platform === "darwin") {
    return normalizeFinderOutput(
      await run("/usr/bin/osascript", ["-e", FINDER_SCRIPT], FINDER_TIMEOUT_MS),
    );
  }
  if (platform === "win32") {
    const encoded = Buffer.from(EXPLORER_SCRIPT, "utf16le").toString("base64");
    const output = await run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      EXPLORER_TIMEOUT_MS,
    );
    return pickExplorerFolder(parseExplorerWindows(output));
  }
  return null;
}
