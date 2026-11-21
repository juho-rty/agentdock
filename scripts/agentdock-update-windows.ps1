# Install an AgentDock update downloaded by an agent-run update, then clean up after it.
# Re-launches itself through WMI (parent = WmiPrvSE.exe) with ELECTRON_RUN_AS_NODE cleared so it
# escapes agent process-tree termination (`taskkill /T`) when AgentDock closes and never starts the
# new Electron app in Node mode:
#   powershell -NoProfile -ExecutionPolicy Bypass -File agentdock-update-windows.ps1 `
#     -Installer C:\Users\Public\agentdock-maintenance\v0.1.36\AgentDock-0.1.36-x64.exe
# NSIS replaces the app in place, so nothing needs backing up. Once the new version is
# running, the installer and every older v* folder next to its folder are removed.
param(
  [Parameter(Mandatory)][string]$Installer,
  [switch]$Detached
)
$ErrorActionPreference = 'Continue'
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Remove-Item Env:CHROME_CRASHPAD_PIPE_NAME -ErrorAction SilentlyContinue

$root = Split-Path (Split-Path $Installer -Parent) -Parent
$log = Join-Path $root 'update-agentdock.log'
function Log($m) { Add-Content $log "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $m" }
function Running { Get-Process AgentDock -ErrorAction SilentlyContinue | Where-Object Path | Select-Object -First 1 }
function Ver($v) { try { ([version]$v).ToString(3) } catch { $null } }

if ((Split-Path $Installer -Leaf) -notmatch '^AgentDock-(\d+\.\d+\.\d+)-') { Log "cannot read a version from $Installer"; exit 1 }
$want = $Matches[1]

if (-not $Detached) {
  $psExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $cmdLine = "`"$psExe`" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$PSCommandPath`" -Installer `"$Installer`" -Detached"
  try {
    $startup = New-CimInstance -ClassName Win32_ProcessStartup -Property @{ ShowWindow = [uint16]0 } -ClientOnly
    $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine; ProcessStartupInformation = $startup } -ErrorAction Stop
    if ($res.ReturnValue -eq 0) {
      Log "submitted detached updater PID=$($res.ProcessId) for $want via WMI"
      exit 0
    }
  } catch {}
  $p = Start-Process -FilePath $psExe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',$PSCommandPath,'-Installer',$Installer,'-Detached')
  Log "started detached updater PID=$($p.Id) for $want via Start-Process"
  exit 0
}

$exe = (Running).Path
if (-not $exe) { $exe = Join-Path $env:LOCALAPPDATA 'Programs\AgentDock\AgentDock.exe' }
Log "updating to $want with $Installer"
Start-Sleep 20
$p = Start-Process $Installer -ArgumentList '/S', '--force-run' -PassThru -Wait
Log "installer exited with $($p.ExitCode)"
Start-Sleep 30
if (-not (Running)) {
  if ($exe -and (Test-Path $exe)) { Log "starting $exe"; Start-Process $exe; Start-Sleep 30 }
}
$proc = Running
if (-not $proc) { Log "AgentDock is not running; kept $Installer"; exit 1 }
$got = Ver (Get-Item $proc.Path).VersionInfo.ProductVersion
if ($got -ne $want) { Log "running version is '$got', expected $want; kept $Installer"; exit 1 }

Remove-Item $Installer -Force -ErrorAction SilentlyContinue
Get-ChildItem $root -Directory -Filter 'v*' | ForEach-Object {
  $v = Ver $_.Name.Substring(1)
  if ($v -and [version]$v -lt [version]$want) { Remove-Item $_.FullName -Recurse -Force -ErrorAction SilentlyContinue }
}
Log "running $want; removed the installer and older version folders"
