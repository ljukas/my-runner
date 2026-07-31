#!/usr/bin/env bash
# Bring the installed e2e-simulator app in line with the working tree, taking the
# cheap path when it is available: repack current JS into the already-built
# native .app (~1 min) instead of a full `eas build --local` (~15-20 min).
# Mirrors the fingerprint gate in .github/workflows/e2e.yml.
#
# APP_VARIANT=e2e is exported for every Expo invocation because the e2e-ios job
# sets it at JOB level — without it the fingerprint is the production variant's
# (verified: different hash) and the repack bundles the wrong app identity.
#
#   exit 0  installed app matches the working tree, proved by bundle hash
#   exit 3  a full native build is needed first; the message says what to run
#   exit 1  anything else
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

export APP_VARIANT=e2e
export EXPO_PUBLIC_E2E=1 # compressed plan, inlined at bundle time (eas.json → e2e-simulator)

APP_ID=se.lukaslindqvist.runbro.e2e
BUILD=build
TARBALL="$BUILD/e2e-simulator.tar.gz"
FP_FILE="$BUILD/.e2e-fingerprint"

die() {
  printf 'error: %s\n' "$1" >&2
  exit "${2:-1}"
}
say() { printf '%s\n' "$1"; }
native_app() { find "$BUILD" -maxdepth 1 -name '*.app' -type d ! -name 'repacked.app' 2>/dev/null | head -1 || true; }
fingerprint() { npx expo-updates fingerprint:generate --platform ios 2>/dev/null | jq -r '.hash'; }

# 1. Target simulator ---------------------------------------------------------
udids=$(xcrun simctl list devices booted --json | jq -r '[.devices[][]] | .[].udid')
[ -n "$udids" ] || die "no booted simulator — boot one first (argent boot-device)"
count=$(printf '%s\n' "$udids" | grep -c . || true)
[ "$count" -eq 1 ] || die "$count simulators booted; shut down all but the target so the install is unambiguous"
UDID=$udids
say "simulator: $UDID"

# 2. Adopt a fresh full build if one is sitting in build/ ---------------------
if [ -f "$TARBALL" ]; then
  existing=$(native_app)
  if [ -z "$existing" ] || [ "$TARBALL" -nt "$existing" ]; then
    say "extracting $TARBALL (newer than the extracted .app)"
    [ -n "$existing" ] && rm -rf "$existing"
    tar -xzf "$TARBALL" -C "$BUILD"
    # why: do NOT stamp the CURRENT tree's fingerprint here. Extracting an old tarball today would
    # record today's hash against yesterday's binary, and the gate below would then report a match and
    # repack onto a native shell missing modules the config now requires (observed: a pre-expo-maps app
    # passing the gate, then crashing on `Cannot find native module 'ExpoMaps'`). Only `e2e:build`, which
    # knows the tree it actually built from, may record a fingerprint — so an unstamped tarball fails
    # closed below rather than silently passing.
    if [ -f "$FP_FILE" ]; then
      say "adopted $TARBALL; build-recorded fingerprint: $(cat "$FP_FILE")"
    else
      say "adopted $TARBALL, but it carries no build-recorded fingerprint"
    fi
  fi
fi

SOURCE_APP=$(native_app)
[ -n "$SOURCE_APP" ] || die "no native .app in $BUILD/.
Run a full build first — it is slow, so run it in the background:
  bun run e2e:build
then re-run this script." 3

# 3. Fingerprint gate ---------------------------------------------------------
current=$(fingerprint)
[ -n "$current" ] && [ "$current" != "null" ] || die "fingerprint generation failed"
recorded=$(cat "$FP_FILE" 2>/dev/null || true)

if [ -z "$recorded" ]; then
  die "no build-recorded fingerprint for $SOURCE_APP, so it cannot be trusted to match
the current native config. Repacking JS onto a native shell built from a different config
yields fresh code on the wrong binary — it crashes at import on a missing native module
rather than failing a test. Run a full build, which records the fingerprint it built from:
  bun run e2e:build
then re-run this script." 3
fi

if [ "$current" != "$recorded" ]; then
  die "native fingerprint changed since $SOURCE_APP was built.
  built:   $recorded
  current: $current
Repacking onto a stale native shell yields JS-fresh code on the wrong native
binary. Run a full build in the background:
  bun run e2e:build
then re-run this script.
(If you know $SOURCE_APP already matches the current native config, adopt it:
  echo $current > $FP_FILE)" 3
fi

# 4. Repack current JS into the cached native app -----------------------------
say "fingerprint match — repacking JS into $SOURCE_APP"
rm -rf "$BUILD/repacked.app"
bunx @expo/repack-app --platform ios --source-app "$SOURCE_APP" -o "$BUILD/repacked.app"

# 5. Install ------------------------------------------------------------------
xcrun simctl install "$UDID" "$BUILD/repacked.app"

# 6. Prove the install landed -------------------------------------------------
# A new .app on disk is not a new app on the device: the suite will happily keep
# running the previous install and fail only the flows asserting new behaviour.
container=$(xcrun simctl get_app_container "$UDID" "$APP_ID" app)
built=$(shasum -a 256 "$BUILD/repacked.app/main.jsbundle" | cut -d' ' -f1)
live=$(shasum -a 256 "$container/main.jsbundle" | cut -d' ' -f1)
[ "$built" = "$live" ] || die "install did not land — on device $live, just built $built"

say "verified: $APP_ID now runs the working tree's JS (bundle $built)"
