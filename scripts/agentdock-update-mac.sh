#!/bin/bash
# Swap /Applications/AgentDock.app for the copy staged in an update folder, for agent-run
# updates (the in-app updater cannot replace a running app from inside it). Run it from the
# update folder after staging; it submits itself to launchd (gui/<uid>) so its parent is PID 1
# (escaping agent descendant-reapers when AgentDock quits) and its environment has no
# ELECTRON_RUN_AS_NODE=1 (which LaunchServices would forward through `open -a`, making the new
# Electron app boot as Node and exit immediately):
#   bash agentdock-update-mac.sh "$PWD"
# The folder (for example /Users/Shared/agentdock-maintenance/update-0.1.36) must hold
# stage/AgentDock.app, extracted with `ditto -x -k`. The old app is kept in backup/ only
# until the new one is installed and still running; then backup/, stage/, the zip and every
# older sibling update-* folder are removed. A failed install or launch restores the backup.
set -u
unset ELECTRON_RUN_AS_NODE CHROME_CRASHPAD_PIPE_NAME
export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

W="$(cd "${1:?usage: $0 <update folder>}" && pwd)"
L="$W/swap.log"
SELF="$W/$(basename "$0")"
APP="${AGENTDOCK_APP:-/Applications/AgentDock.app}"
PROC="$APP/Contents/MacOS/"
UID_NUM="$(/usr/bin/id -u)"
USER_NAME="$(/usr/bin/id -un)"
USER_HOME="${HOME:-$(eval echo ~"$USER_NAME")}"
CLEAN_TMPDIR="$(/usr/bin/getconf DARWIN_USER_TEMP_DIR 2>/dev/null || echo /tmp)"
export TMPDIR="$CLEAN_TMPDIR"
LABEL="com.agentdock.updater"
PLIST="$W/$LABEL.plist"

log(){ echo "$(date '+%H:%M:%S') $*" >> "$L"; }
version_of(){ /usr/bin/defaults read "$1/Contents/Info" CFBundleShortVersionString 2>/dev/null; }
xml_escape(){ printf '%s' "$1" | /usr/bin/sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

want="$(version_of "$W/stage/AgentDock.app")"
[ -n "$want" ] || { log "no staged app in $W/stage"; echo "no staged app in $W/stage" >&2; exit 1; }

if [ "${2:-}" != "--launchd" ] && /bin/launchctl print "gui/$UID_NUM" >/dev/null 2>&1; then
  [ "$0" -ef "$SELF" ] || /bin/cp "$0" "$SELF"
  /bin/chmod 700 "$SELF"
  /bin/launchctl bootout "gui/$UID_NUM/$LABEL" >/dev/null 2>&1 || true
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$(xml_escape "$LABEL")</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$(xml_escape "$SELF")</string>
    <string>$(xml_escape "$W")</string>
    <string>--launchd</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$(xml_escape "$W")</string>
  <key>RunAtLoad</key>
  <true/>
  <key>AbandonProcessGroup</key>
  <true/>
</dict>
</plist>
EOF
  if /bin/launchctl bootstrap "gui/$UID_NUM" "$PLIST" >>"$L" 2>&1; then
    log "submitted $LABEL for $want via launchd"
    exit 0
  fi
  rm -f "$PLIST"
  log "launchctl bootstrap failed; falling back to nohup"
  nohup /bin/bash "$SELF" "$W" --launchd >/dev/null 2>&1 &
  disown || true
  exit 0
fi

finish_launchd(){
  rm -f "$PLIST"
  (sleep 1; /bin/launchctl bootout "gui/$UID_NUM/$LABEL" >/dev/null 2>&1) >/dev/null 2>&1 &
}
launch_app(){
  /usr/bin/env -i \
    HOME="$USER_HOME" \
    USER="$USER_NAME" \
    LOGNAME="$USER_NAME" \
    PATH="/usr/bin:/bin:/usr/sbin:/sbin" \
    TMPDIR="$CLEAN_TMPDIR" \
    /usr/bin/open -a "$1" >>"$L" 2>&1
}
quit_app(){
  /usr/bin/osascript -e 'tell application "AgentDock" to quit' >>"$L" 2>&1
  for _ in $(seq 60); do /usr/bin/pgrep -f "$PROC" >/dev/null || return 0; sleep 1; done
  log "force stop"; /usr/bin/pkill -f "$PROC"; sleep 3
}
restore(){
  log "$1, restoring the previous app"
  rm -rf "$APP"; mv "$W/backup/AgentDock.app" "$APP" >>"$L" 2>&1
  launch_app "$APP"; log "opened previous $(version_of "$APP")"
  finish_launchd
  exit 1
}

sleep 20
log "quitting AgentDock"
quit_app
rm -rf "$W/backup"; mkdir -p "$W/backup"
if ! mv "$APP" "$W/backup/AgentDock.app" >>"$L" 2>&1; then
  log "could not move the old app; left as is"; launch_app "$APP"; finish_launchd; exit 1
fi
/usr/bin/ditto "$W/stage/AgentDock.app" "$APP" >>"$L" 2>&1 || restore "install failed"
/usr/bin/xattr -dr com.apple.quarantine "$APP" 2>>"$L"
got="$(version_of "$APP")"
[ "$got" = "$want" ] || restore "installed version is '$got', expected $want"
log "installed $got"
launch_app "$APP"; log "opened"

# Keep the backup until the new app has stayed up for a while.
sleep 30
if ! /usr/bin/pgrep -f "$PROC" >/dev/null; then
  quit_app
  restore "new app is not running"
fi
rm -rf "$W/backup" "$W/stage" "$W"/AgentDock-*.zip
for d in "$(dirname "$W")"/update-*; do
  v="${d##*/update-}"
  [ -d "$d" ] && [ "$d" != "$W" ] || continue
  # Only older versions, so a newer update being staged next to this one survives.
  [ "$(printf '%s\n%s\n' "$v" "$want" | sort -V | head -n 1)" = "$v" ] && rm -rf "$d"
done
log "running $want; removed backup, stage, zip and older update folders"
finish_launchd
