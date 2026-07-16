# 18. iOS-only for now: Android support deferred, no `android/` generation

Date: 2026-07-15

## Status

Proposed — draft for review. Flip to `Accepted` on merge.

## Context

`AGENTS.md` has always framed the app as iOS-primary with Android as a secondary
target, and several ADRs pre-committed the *shape* of eventual Android support:
the ports-&-adapters seam (ADR 0003), the @expo/ui Android view fork (ADR 0005),
modal presentation fallbacks (ADR 0006), background-execution / audio / Health /
elevation adapters (ADRs 0008, 0009, 0011, 0015), the tip-jar Play Billing adapter
(ADR 0017), and Play-submit / `android.versionCode` handling (ADR 0012). None of
that Android work has been built — every Android provision is "decided now, built
later."

In practice the project is iOS-only today, and keeping the Android scaffolding
half-present has a concrete cost. Because this is a CNG project, `expo prebuild`
(and `bun run android`, when it existed) generate an `android/` project, and Gradle
then mutates package sources *inside* `node_modules` — e.g. AGP 8 strips the
`package=` attribute from bundled `AndroidManifest.xml` files and dumps
`android/build/` artifacts into ~20 packages. `@expo/fingerprint` hashes those
package sources, so the mutation changes the fingerprint runtime version and breaks
`eas build --local -p ios` with a runtime-version mismatch in the
`CONFIGURE_EXPO_UPDATES` phase (the pre-build fingerprint computed from the polluted
working tree no longer matches the fingerprint the build computes from a clean
install). The recovery is a full `rm -rf node_modules && bun install`.

## Decision

Ship iOS-only for now and stop generating Android artifacts entirely:

- `app.json` sets `"platforms": ["ios"]`, so `expo prebuild` — and therefore EAS
  builds and `expo run` — generate only `ios/`, never `android/`. Verified: a clean
  checkout prebuild produces `ios/` and no `android/`.
- The `android` and `ios` npm scripts are removed; `bun run start` is now
  `expo run:ios`. There is no `bun run android`.
- The generated `android/` directory is deleted (it stays gitignored).
- The `android` config block (`android.package`, adaptive-icon assets,
  `predictiveBackGestureEnabled`) stays in `app.json` so Android can be re-enabled
  cheaply later — it is inert while `platforms` excludes Android.

This is a "for now" posture, not an abandonment. The Android-later provisions in
prior ADRs stay on record as the intended design; each such ADR carries a banner
noting those provisions are deferred and pointing here.

## Consequences

- **The `eas build --local` fingerprint stays stable.** No Android build can run,
  so nothing mutates `node_modules`, so the runtime-version mismatch above cannot
  recur.
- **Re-enabling Android is a documented, cheap reversal.** Add `"android"` back to
  `platforms`, restore an `android` script, and execute the adapter passes the
  prior ADRs describe. The ports-&-adapters discipline (ADR 0003) still holds —
  platform code lives behind ports with `.ios.ts` adapters, so re-adding
  `.android.ts` adapters is the intended re-entry path. Keeping that discipline now
  is what makes "for now" cheap to reverse.
- `tsconfig.android.json` and the Android CI matrix (ADR 0003) are not added while
  there are no Android adapters — as that ADR already anticipated.
- **Docs must agree.** `AGENTS.md` is updated to iOS-only (constraints, commands,
  native-generation notes, E2E `appId`, platform-forks). The Android-mentioning
  ADRs (0001, 0002, 0003, 0005, 0006, 0008, 0009, 0010, 0011, 0012, 0013, 0015,
  0017) carry a deferral banner pointing here; their bodies are left intact as the
  historical record of the intended Android design.

## Affected ADRs

Deferral banners point to this ADR from: 0001, 0002, 0003, 0005, 0006, 0008, 0009,
0010, 0011, 0012, 0013, 0015, 0017.
