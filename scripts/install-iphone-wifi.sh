#!/usr/bin/env bash
# Build the streamlined AgentDock iPhone Release app (Personal Team) and install it over Wi-Fi/USB.
#
# Usage:
#   vp run ios:wifi                 # Build Release .app (prebuilding once if needed) + Wi-Fi install
#   vp run ios:wifi:install         # Install already-built Release .app over Wi-Fi in ~5 seconds
#   vp run ios:wifi:rebuild         # Clean Expo prebuild + Release build + Wi-Fi install
#   bash scripts/install-iphone-wifi.sh --build-only
#   bash scripts/install-iphone-wifi.sh --simulator
#   bash scripts/install-iphone-wifi.sh --device <UDID>   # also registers a new iPhone for signing
set -euo pipefail

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.vite-plus/bin:$PATH"
export LANG="${LANG:-en_US.UTF-8}"
export LC_ALL="${LC_ALL:-en_US.UTF-8}"

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MOBILE_DIR="$REPO_ROOT/apps/mobile"
DERIVED_DATA_DIR="$HOME/Library/Developer/Xcode/DerivedData/AgentDock-Mobile-Release"
ARTIFACT_DIR="/Users/Shared/agentdock-maintenance/ios-release"

CLEAN_PREBUILD=0
BUILD_ONLY=0
INSTALL_ONLY=0
SIMULATOR_BUILD=0
TARGET_DEVICE="${IOS_DEVICE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN_PREBUILD=1
      shift
      ;;
    --build-only)
      BUILD_ONLY=1
      shift
      ;;
    --install-only)
      INSTALL_ONLY=1
      shift
      ;;
    --simulator)
      SIMULATOR_BUILD=1
      BUILD_ONLY=1
      shift
      ;;
    --device)
      TARGET_DEVICE="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 1
      ;;
  esac
done

detect_team_id() {
  if [[ -n "${T3CODE_IOS_TEAM_ID:-}" ]]; then
    echo "$T3CODE_IOS_TEAM_ID"
    return 0
  fi

  local profile
  for profile in "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"/*.mobileprovision \
                 "$HOME/Library/MobileDevice/Provisioning Profiles"/*.mobileprovision; do
    [[ -f "$profile" ]] || continue
    local team
    team="$(security cms -D -i "$profile" 2>/dev/null | plutil -extract TeamIdentifier.0 raw -o - - 2>/dev/null || true)"
    if [[ -n "$team" ]]; then
      echo "$team"
      return 0
    fi
  done

  security find-identity -v -p codesigning 2>/dev/null \
    | sed -nE 's/.*"Apple Development:.*\(([A-Z0-9]{10})\)".*/\1/p' \
    | head -n 1
}

find_online_iphone() {
  if [[ -n "$TARGET_DEVICE" ]]; then
    echo "$TARGET_DEVICE"
    return 0
  fi

  local tmp_json
  tmp_json="$(mktemp -t agentdock-devices.XXXXXX.json)"
  if ! xcrun devicectl list devices --json-output "$tmp_json" >/dev/null 2>&1; then
    rm -f "$tmp_json"
    return 1
  fi

  python3 - "$tmp_json" <<'PY'
import json, sys
path = sys.argv[1]
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)
devices = data.get("result", {}).get("devices", [])
for d in devices:
    hw = d.get("hardwareProperties", {})
    conn = d.get("connectionProperties", {})
    if hw.get("reality") != "physical" or hw.get("platform") != "iOS":
        continue
    tunnel = conn.get("tunnelState", "")
    pairing = conn.get("pairingState", "")
    transport = conn.get("transportType", "")
    # Accept any paired device that is currently reachable over Wi-Fi (localNetwork) or wired USB.
    if pairing == "paired" and tunnel not in ("unavailable", ""):
        udid = hw.get("udid") or d.get("identifier")
        name = d.get("deviceProperties", {}).get("name", "iPhone")
        print(f"{udid}\t{name}\t{transport}\t{tunnel}")
        sys.exit(0)
sys.exit(1)
PY
  local rc=$?
  rm -f "$tmp_json"
  return $rc
}

export APP_VARIANT=production
export T3CODE_IOS_PERSONAL_TEAM=1
export T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID="${T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID:-kr.ac.snu.jeongjuho.agentdock}"
export EXPO_NO_GIT_STATUS=1

TEAM_ID="$(detect_team_id || true)"
if [[ "$SIMULATOR_BUILD" -eq 0 && -z "$TEAM_ID" ]]; then
  echo "Error: Could not find an Apple Development signing team in Xcode/Keychain." >&2
  echo "Open Xcode -> Settings -> Accounts and sign in with your Apple ID, or pass T3CODE_IOS_TEAM_ID=<TEAM_ID>." >&2
  exit 1
fi
if [[ -n "$TEAM_ID" ]]; then
  export T3CODE_IOS_TEAM_ID="$TEAM_ID"
fi

echo "==> Bundle ID : $T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID"
[[ -n "$TEAM_ID" ]] && echo "==> Team ID   : $TEAM_ID (Personal Team)"

bash "$REPO_ROOT/tools/dropbox-ignore.sh" >/dev/null

if [[ "$INSTALL_ONLY" -eq 0 ]]; then
  WORKSPACE_PATH="$(find "$MOBILE_DIR/ios" -maxdepth 1 -name "*.xcworkspace" 2>/dev/null | head -n 1 || true)"
  if [[ "$CLEAN_PREBUILD" -eq 1 || -z "$WORKSPACE_PATH" ]]; then
    echo "==> Generating native iOS project (Expo prebuild, Lite Personal Team profile)..."
    mkdir -p "$MOBILE_DIR/ios"
    xattr -w com.dropbox.ignored 1 "$MOBILE_DIR/ios" 2>/dev/null || true
    (
      cd "$MOBILE_DIR"
      npx expo prebuild --clean --platform ios
    )
    xattr -w com.dropbox.ignored 1 "$MOBILE_DIR/ios" 2>/dev/null || true
  fi

  WORKSPACE_PATH="$(find "$MOBILE_DIR/ios" -maxdepth 1 -name "*.xcworkspace" | head -n 1)"
  SCHEME_NAME="$(basename "$WORKSPACE_PATH" .xcworkspace)"

  if [[ "$SIMULATOR_BUILD" -eq 1 ]]; then
    echo "==> Building standalone Release app for iOS Simulator ($SCHEME_NAME)..."
    xcodebuild \
      -workspace "$WORKSPACE_PATH" \
      -scheme "$SCHEME_NAME" \
      -configuration Release \
      -sdk iphonesimulator \
      -destination "generic/platform=iOS Simulator" \
      -derivedDataPath "$DERIVED_DATA_DIR" \
      CODE_SIGNING_ALLOWED=NO \
      build | tail -n 40
    BUILT_APP="$DERIVED_DATA_DIR/Build/Products/Release-iphonesimulator/$SCHEME_NAME.app"
    echo "==> Simulator Release app built at: $BUILT_APP"
    exit 0
  fi

  # A named device makes automatic signing register its UDID (a free Personal Team profile only
  # runs on registered devices); the generic destination keeps whatever the profile already has.
  BUILD_DESTINATION="generic/platform=iOS"
  [[ -n "$TARGET_DEVICE" ]] && BUILD_DESTINATION="id=$TARGET_DEVICE"
  echo "==> Building standalone Release app for iPhone ($SCHEME_NAME) — no Metro needed at runtime..."
  xcodebuild \
    -workspace "$WORKSPACE_PATH" \
    -scheme "$SCHEME_NAME" \
    -configuration Release \
    -destination "$BUILD_DESTINATION" \
    -derivedDataPath "$DERIVED_DATA_DIR" \
    -allowProvisioningUpdates \
    -allowProvisioningDeviceRegistration \
    DEVELOPMENT_TEAM="$TEAM_ID" \
    CODE_SIGN_STYLE=Automatic \
    build | tail -n 40

  BUILT_APP="$(find "$DERIVED_DATA_DIR/Build/Products/Release-iphoneos" -maxdepth 1 -name "*.app" | head -n 1)"
  if [[ -z "$BUILT_APP" || ! -d "$BUILT_APP" ]]; then
    echo "Error: Release .app not found under $DERIVED_DATA_DIR/Build/Products/Release-iphoneos" >&2
    exit 1
  fi

  mkdir -p "$ARTIFACT_DIR"
  rm -rf "$ARTIFACT_DIR/AgentDock.app"
  ditto "$BUILT_APP" "$ARTIFACT_DIR/AgentDock.app"
  echo "==> Standalone Release app staged at: $ARTIFACT_DIR/AgentDock.app"
fi

if [[ "$BUILD_ONLY" -eq 1 ]]; then
  exit 0
fi

APP_TO_INSTALL="$ARTIFACT_DIR/AgentDock.app"
if [[ ! -d "$APP_TO_INSTALL" ]]; then
  APP_TO_INSTALL="$(find "$DERIVED_DATA_DIR/Build/Products/Release-iphoneos" -maxdepth 1 -name "*.app" 2>/dev/null | head -n 1 || true)"
fi
if [[ -z "$APP_TO_INSTALL" || ! -d "$APP_TO_INSTALL" ]]; then
  echo "Error: No built Release app found. Run 'vp run ios:wifi' without --install-only first." >&2
  exit 1
fi

echo "==> Looking for iPhone on Wi-Fi / USB..."
if DEVICE_INFO="$(find_online_iphone)"; then
  DEVICE_UDID="$(printf '%s' "$DEVICE_INFO" | cut -f1)"
  DEVICE_NAME="$(printf '%s' "$DEVICE_INFO" | cut -f2)"
  DEVICE_TRANSPORT="$(printf '%s' "$DEVICE_INFO" | cut -f3)"
  echo "==> Installing AgentDock onto $DEVICE_NAME ($DEVICE_UDID via ${DEVICE_TRANSPORT:-Wi-Fi})..."
  xcrun devicectl device install app --device "$DEVICE_UDID" "$APP_TO_INSTALL"
  echo "==> Launching AgentDock on $DEVICE_NAME..."
  xcrun devicectl device process launch --device "$DEVICE_UDID" "$T3CODE_IOS_PERSONAL_TEAM_BUNDLE_ID" || true
  echo "==> Done! If iOS asks to trust the developer on first install:"
  echo "    iPhone Settings -> General -> VPN & Device Management -> Trust your Apple ID."
else
  echo ""
  echo "================================================================================"
  echo " Release build is ready at: $APP_TO_INSTALL"
  echo " No unlocked iPhone was reachable over Wi-Fi right now."
  echo ""
  echo " To finish installing over Wi-Fi in ~5 seconds:"
  echo "   1. Make sure your iPhone is unlocked and on the same Wi-Fi network as Mac mini"
  echo "      (If never paired for wireless debugging before, connect via USB cable once"
  echo "       with Developer Mode enabled in Settings -> Privacy & Security -> Developer Mode)."
  echo "   2. Run: vp run ios:wifi:install"
  echo "================================================================================"
  exit 2
fi
