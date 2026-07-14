# E2E fingerprint-gated `.app` reuse — design

Date: 2026-07-13
Status: Approved design, pending implementation

## Goal

Cut the `e2e-ios` CI wall-clock for the common case — PRs that change only JS —
by **reusing a cached native simulator `.app`** when the native fingerprint is
unchanged and refreshing only the JS layer with `@expo/repack-app`. A full
`eas build --local` runs only when the fingerprint changes (a real native
change) or on the first build of a given fingerprint.

Builds on the E2E gate shipped in PR #28
([design](2026-07-13-github-actions-maestro-e2e-design.md),
[ADR 0001](../../adr/0001-local-first-maestro-e2e-testing.md)). iOS only.

## Context / key facts (verified)

- **Today every `e2e-ios` run does a full build.** On `macos-26`: ~19 min
  `eas build --local` + ~3.5 min Maestro ≈ ~25 min total. The build dominates.
- **`eas build --local` cannot cache.** EAS skips both `RESTORE_CACHE` and
  `SAVE_CACHE` phases when `ctx.isLocal` (confirmed in EAS `build-tools`
  source); the `eas.json` `cache` field is cloud-only. So per-build artifact
  caching is not available on the current path — reuse must happen at the
  `.app` level.
- **The fingerprint excludes JS.** `@expo/fingerprint` (driven by this repo's
  `fingerprint.config.js`) hashes the native layer — native deps, config
  plugins, `app.json` config, native files — **not** `src/**` JS. So a JS-only
  PR keeps the same fingerprint. This is the same hash that drives
  `runtimeVersion: { policy: "fingerprint" }` (ADR 0012).
- **`@expo/repack-app` is the official JS-swap tool.** It repackages an existing
  iOS `.app` (simulator) with a freshly-bundled JS + assets, **skipping native
  compilation** ("significantly faster than a full native build… ideal for
  scenarios where only the JavaScript layer has changed"). By **default** it
  also regenerates app metadata **including the expo-updates embedded manifest
  (`app.manifest`)**, so the swapped bundle passes expo-updates' consistency
  check — no integrity break, no `app.json`/updates changes needed.
  `--platform ios --source-app <x>.app`; output format matches input.
  Docs: https://docs.expo.dev/build-reference/repack
- **GitHub Actions cache** is 10 GB/repo with 7-day-idle LRU eviction, and
  caches created on the default branch (`main`) are restorable from PR
  branches. A simulator `.app` is tens of MB.

## Decisions

### 1. Two-path `e2e-ios` job — build on cache miss, repack on cache hit

New steps in `.github/workflows/e2e.yml`, inserted after `bun ci` and before
the boot-simulator step, all under the existing `steps.decide.outputs.run ==
'true'` guard:

1. **Fingerprint** — compute the native fingerprint hash (via
   `expo-updates fingerprint:generate`, which respects `fingerprint.config.js`)
   → step output `fp`.
2. **`actions/cache`** — `path: $RUNNER_TEMP/native-app`, `key:
   e2e-native-app-ios-<fp>` → output `cache-hit`.
3. **Build (cache MISS only)** — the existing `eas build --local` step, now
   `if: … && steps.cache.outputs.cache-hit != 'true'`. Extract the `.app` into
   `$RUNNER_TEMP/native-app/` so `actions/cache` saves it at job end under the
   fingerprint key.
4. **Repack (cache HIT only)** — `npx @expo/repack-app --platform ios
   --source-app $RUNNER_TEMP/native-app/<app>.app -o $RUNNER_TEMP/repacked.app`
   (default mode → regenerates JS bundle + assets + updates manifest from the
   current commit; runs Metro, so it needs the `bun ci` node_modules already
   present).
5. **Converge** — set `APP_PATH` = the repacked app (hit) or the freshly-built
   app (miss); the boot-sim / install / `maestro test` steps are unchanged.

### 2. Cache key = the fingerprint hash alone

Native identity is exactly what the fingerprint captures, and `main`'s caches
flow down to PR branches — so a fingerprint first built on `main` (or any PR)
is reused by every later PR that doesn't touch native.

### 3. Repack-failure fallback → full build

If `@expo/repack-app` errors for any reason, the job falls back to a full
`eas build --local` in the same run. The gate is never skipped or falsely
green; worst case is a slower run.

### 4. No `app.json` / expo-updates / dynamic-config changes

`repack-app` regenerates the embedded updates manifest itself, so the fingerprint,
`runtimeVersion`, and `updates` config stay untouched (respects ADR 0012 and the
AGENTS.md "never weaken fingerprint" rule).

## Correctness — why the repacked app is a faithful test target

On a cache hit the installed `.app` is **byte-identical native code** to a full
build (it *is* a prior full build) with only the JS bundle + assets refreshed to
the current commit and the updates manifest regenerated to match. Because JS is
not part of the fingerprint, "native unchanged" ⇔ "fingerprint unchanged" ⇔
"the cached `.app` is still a valid native host for this commit's JS." So a
hit-path run exercises the real native app plus the PR's real JS — no fidelity
loss versus a full build.

## Expected impact

- **JS-only PR (common):** ~25 min → **~5–7 min** (cache restore + repack ~2–4
  min + Maestro ~3.5 min).
- **Native-changing PR (rare):** unchanged (~25 min) — full build, then cached
  under the new fingerprint.
- **First build of any new fingerprint:** full build; every subsequent JS-only
  PR on that fingerprint hits.

## Deliberately excluded

- **True EAS Update (OTA) round-trip** — more launch/apply latency and flow
  complexity than a local repack, and metered by MAU. The repack achieves the
  same "reuse native, refresh JS" outcome deterministically and offline.
- **Caching `eas build --local` internals** — unsupported (see Context).
- **Hand-rolled `expo prebuild` + `xcodebuild` + DerivedData/Pods cache** —
  abandons the `eas build --local` flavor path and RN DerivedData caches are
  large/flaky; the fingerprint `.app` reuse is simpler and higher-leverage.
- **Android** — still iOS only.

## Known risks

- **Fingerprint command stability** — the plan must pin the exact command and
  parse its output (JSON `hash`) and confirm it changes on a native edit and not
  on a JS edit. If `expo-updates fingerprint:generate`'s flags/output differ,
  fall back to `@expo/fingerprint`.
- **Release-mode bundle** — `repack-app` infers build type from the source
  `.app` (a release/preview build) and should emit a production JS bundle;
  verify the repacked app runs a non-dev bundle.
- **Repack must inline the profile's `EXPO_PUBLIC_*` vars** — repack re-bundles
  JS via `expo export:embed`, which reads `EXPO_PUBLIC_*` from *its own* env, not
  from the eas.json profile. The repack step must set the same vars the
  `e2e-simulator` profile does (currently `EXPO_PUBLIC_E2E=1`) or the repacked
  app runs the real NHS plan and full-session flows time out. (Caught on the
  first cache-hit CI run.)
- **Cache churn/eviction** — many distinct fingerprints or 7-day idle eviction
  cause occasional full builds; correct, just slower.
- **expo-updates fetch on launch** — unchanged from today: the built app already
  has `updates.url` set and falls back to the embedded bundle when no update is
  reachable; the repack keeps that behavior, so flows are unaffected.

## Verification

1. A PR changing only `src/**` → `e2e-ios` logs a cache **HIT**, runs the repack
   path (no `eas build`), finishes in ~5–7 min, 3/3 flows pass.
2. A PR touching a native input (dependency, config plugin, or `app.json`) →
   cache **MISS**, full build, `.app` saved under the new fingerprint.
3. Prove freshness: a visible copy change in `src/` is reflected in the cache-hit
   Maestro run (the repacked app runs the new JS, not the cached JS).
4. Simulate a repack failure → job falls back to a full build and still passes.
5. `bun test` / `bun run typecheck` / `bun run lint` unaffected — this is a
   workflow + docs change only, no product-code change.
