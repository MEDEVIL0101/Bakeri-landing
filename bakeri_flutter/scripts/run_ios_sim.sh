#!/bin/bash
# Workaround for a local codesigning quirk that blocks plain `flutter run` /
# `flutter build ios` on this Mac — see README "Known issue: flutter run
# fails to codesign on this Mac" for the full diagnosis. Builds via
# xcodebuild directly (which doesn't hit the bug) and installs+launches on
# the simulator via simctl. You still get a real, running app — you just
# lose `flutter run`'s hot reload; use `r`/`R` isn't available this way,
# re-run this script after each change instead.
#
# Usage: scripts/run_ios_sim.sh ["iPhone 16 Pro"]

set -euo pipefail
cd "$(dirname "$0")/.."

SIM_NAME="${1:-iPhone 16 Pro}"
BUNDLE_ID="com.bakeri.bakeriApp"

UDID=$(xcrun simctl list devices available | grep "$SIM_NAME (" | grep -oE '[0-9A-F-]{36}' | head -1)
if [ -z "$UDID" ]; then
  echo "No simulator matching '$SIM_NAME' found. Run: xcrun simctl list devices available"
  exit 1
fi

STATE=$(xcrun simctl list devices | grep "$UDID" | grep -oE '\(Booted\)|\(Shutdown\)' || true)
if [ "$STATE" != "(Booted)" ]; then
  echo "Booting $SIM_NAME ($UDID)..."
  xcrun simctl boot "$UDID"
  sleep 3
fi
open -a Simulator --args -CurrentDeviceUDID "$UDID" >/dev/null 2>&1 || true

# Regenerate Flutter's Xcode config/asset bundle. Expected to exit non-zero
# on this Mac (it fails at the same codesign step) — that's fine, everything
# it does *before* that step (Dart compile, asset bundling, Generated.xcconfig)
# still lands, which is all xcodebuild below actually needs.
flutter build ios --debug --simulator || true

echo "Building via xcodebuild (bypasses the codesign quirk)..."
xcodebuild \
  -workspace ios/Runner.xcworkspace \
  -scheme Runner \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination "id=$UDID" \
  build

APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -path "*Debug-iphonesimulator/Runner.app" -newer ios/Runner.xcworkspace 2>/dev/null | head -1)
if [ -z "$APP_PATH" ]; then
  APP_PATH=$(find ~/Library/Developer/Xcode/DerivedData -path "*Debug-iphonesimulator/Runner.app" -print0 | xargs -0 ls -dt | head -1)
fi

echo "Installing $APP_PATH..."
xcrun simctl install "$UDID" "$APP_PATH"
xcrun simctl launch "$UDID" "$BUNDLE_ID"
echo "Launched. If the simulator window isn't focused, open Simulator.app."
