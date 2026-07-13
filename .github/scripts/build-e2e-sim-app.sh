#!/usr/bin/env bash
# Build the e2e-simulator app via `eas build --local` and extract the .app.
# Usage: bash .github/scripts/build-e2e-sim-app.sh <dest-dir>
# Result: <dest-dir>/app.app  (requires EXPO_TOKEN in the environment).
set -euo pipefail

DEST="$1"
mkdir -p "$DEST"

bunx eas-cli build \
  --platform ios \
  --profile e2e-simulator \
  --local \
  --non-interactive \
  --output "$DEST/app.tar.gz"

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
