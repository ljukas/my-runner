#!/usr/bin/env bash
# Build the e2e-simulator profile via `eas build --local`.
# Usage: bash .github/scripts/build-e2e-app.sh <ios|android> <dest-dir>
# Result: <dest-dir>/app.app (iOS simulator) or <dest-dir>/app.apk (Android)
# (requires EXPO_TOKEN in the environment).
set -euo pipefail

PLATFORM="$1"
DEST="$2"
mkdir -p "$DEST"

build() {
  bunx eas-cli build \
    --platform "$PLATFORM" \
    --profile e2e-simulator \
    --local \
    --non-interactive \
    --output "$1"
}

case "$PLATFORM" in
  android)
    build "$DEST/app.apk"
    echo "Built: $DEST/app.apk"
    ;;
  ios)
    build "$DEST/app.tar.gz"
    tar -xzf "$DEST/app.tar.gz" -C "$DEST"
    rm -f "$DEST/app.tar.gz"
    APP=$(find "$DEST" -maxdepth 3 -name '*.app' -type d | head -1)
    if [ -z "$APP" ]; then
      echo "::error::no .app found after extracting the EAS build output" >&2
      exit 1
    fi
    if [ "$APP" != "$DEST/app.app" ]; then
      mv "$APP" "$DEST/app.app"
    fi
    echo "Built: $DEST/app.app"
    ;;
  *)
    echo "::error::platform must be ios or android, got '$PLATFORM'" >&2
    exit 1
    ;;
esac
