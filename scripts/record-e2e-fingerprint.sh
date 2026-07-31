#!/usr/bin/env bash
# Records the native fingerprint of the tree `e2e:build` just built, for the
# e2e-refresh gate (.claude/skills/e2e-refresh/refresh.sh) to compare against.
#
# why the env vars: eas.json's e2e-simulator profile sets them for the BUILD, in
# its own subprocess — a fingerprint step chained onto `bun run e2e:build`
# inherits only the caller's shell. app.config.ts branches the bundle id, name
# and scheme on APP_VARIANT (ADR 0019), so without them this records the
# production variant's hash, refresh.sh compares the e2e variant's, and the
# repack path is unreachable no matter how little the tree changed.
#
# why the temp file: a direct `> record` truncates it before the command runs, so
# a missing jq or a failed generate destroys a good record — turning a
# just-finished 20-minute build into a reported failure and a second rebuild.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}"

export APP_VARIANT=e2e
export EXPO_PUBLIC_E2E=1

record=build/.e2e-fingerprint

# jq -e fails on a null .hash, so a generate that reports success without a hash
# stops the chain here rather than recording "null" as if it were one.
npx expo-updates fingerprint:generate --platform ios | jq -er '.hash' >"$record.next"
mv "$record.next" "$record"

printf 'recorded native fingerprint: %s\n' "$(cat "$record")"
