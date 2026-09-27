#!/usr/bin/env bash
# Build the e2e-simulator profile's Android APK via `eas build --local`.
# Usage: bash .github/scripts/build-e2e-android-app.sh <dest-dir>
# Result: <dest-dir>/app.apk  (requires EXPO_TOKEN in the environment).
set -euo pipefail

DEST="$1"
mkdir -p "$DEST"

bunx eas-cli build \
  --platform android \
  --profile e2e-simulator \
  --local \
  --non-interactive \
  --output "$DEST/app.apk"

echo "Built: $DEST/app.apk"
