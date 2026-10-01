# Free run — stage 5b: an owned Apple Health module

Date: 2026-10-01
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §6 · ADR:
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) §8,
[0011](../../adr/0011-apple-health-kingstinct-healthkit.md) · stacked on 5a (#91)

## Goal

iOS workouts in Apple Health show what the runner did: the intervals, the pauses and a duration that
excludes them. This uses the spike §6 asks for, run on the simulator first, with the device checks
left to the owner.

## Owner decisions (2026-10-01)

- **Spike:** the simulator first, with `modules/apple-health/` and a development re-save hook. Then a
  short device checklist (H1–H5) that the owner runs.
- **Criterion 1's bar is "distinct visible intervals"**, even unlabelled. Had it failed, the useful
  subset would ship anyway.
- **A locked finish writes at once** (revised after the Apple best-practice review). HealthKit caches
  locked writes, so the first build's wait for an unlock was dropped.
- **Full replacement:** the module owns every HealthKit call and has its own config plugin, and
  `@kingstinct/react-native-healthkit`, Nitro and `with-healthkit-write-only.js` go. The owner wants
  both health integrations owned, one at a time; Android follows in #90.
- **One distance sample per interval** (revised after the same review). Apple encourages samples
  of a minute or less, and per-interval samples give each interval its own pace. Splitting per
  pause gap gave every interval the same pace.

## Design

- **Native** (`modules/apple-health/ios/`):
  - `AppleHealthModule.swift` provides `isAvailable`, `authorizationStatus` (synchronous, an
    `Enumerable`), `requestWriteAccess` and `saveWorkout`. HealthKit errors reach JS as
    `ERR_HEALTHKIT_<code>` (`AppleHealthExceptions.swift`).
  - `WorkoutWriter.swift` writes at once, inside a background task. It first deletes the app's own
    distance samples inside the workout's window. Then it drives `HKWorkoutBuilder`:
    1. the route through the series builder;
    2. the metadata (sync, `IndoorWorkout = false`, time zone);
    3. the pause/resume events and one `.running` activity per interval, tagged
       `RunBroSegmentKind`;
    4. the per-interval distance samples, added last because a sample saves at once;
    5. `finishWorkout`. A nil workout means it saved while locked.
  - If HealthKit refuses the intervals (`errorInvalidArgument` from adding them or from
    `finishWorkout`), the save writes a plain workout one sync version up. Any other error fails the
    save, and the summary's button retries.
  - Records mark the sync identifiers and the window as required. The segment kind is an
    `Enumerable`.
- **Pure** (`bun test`): `services/health/healthkit.ts` maps `HealthWorkoutInput` to the wire
  payload (`modules/apple-health/types.ts`).
  - The distance becomes one part per interval, or per stretch between pauses when a run has no
    intervals. Each part is weighted by the route inside it, or by time without a route. Parts are
    clamped at zero, empty ones are dropped, and they sum to the total.
  - Route points with an accuracy that is unknown or worse than 50 m are dropped.
  - `domain/health.ts` marks a fix without an altitude as vertically invalid.
- **Plugin:** `plugins/with-apple-health.js` (`createRunOncePlugin`) sets the entitlement and the
  update purpose string, never the read string.
- **Development:** `syncRunToHealth(runId, { resave: true })` and `resaveLatestRunToHealth()`, which
  the root layout registers under `__DEV__`.

## Commits

1. `chore:` the development re-save hook.
2. `feat:` the module, the mapping, the adapter, the plugin, and the removed packages.
3. `docs:` this plan, the ADR 0011 and 0026 amendments, the device checklist, and AGENTS.md.

## Verification

- `bun test` (820), both typechecks, lint, and `bunx expo export` for both platforms.
- The generated `Info.plist` and entitlements are byte-identical before and after (`prebuild --clean`).
- Fingerprints moved on both platforms, as accepted:

  | Variant               | 5a         | 5b         |
  | --------------------- | ---------- | ---------- |
  | iOS unset             | `9d09364…` | `f94373d…` |
  | iOS `development`     | `4cf7631…` | `025a76f…` |
  | iOS `e2e`             | `9419024…` | `f0238fa…` |
  | Android unset         | `6bb185f…` | `4a83a62…` |
  | Android `development` | —          | `273badd…` |
  | Android `e2e`         | —          | `3ebafb7…` |

- On the iOS 26.5 simulator, read in its Health app (below). On a device: H1–H5.

## Found on the simulator (2026-10-01)

- **The sheet:** onboarding's _Connect Apple Health_ opened HealthKit's sheet with only an "Allow to
  write" section (Walking + Running Distance, Workout Routes, Workouts).
- **A plan run with a skip and a 20 s pause** showed in Health as:
  - Duration 1m 27.5s, which is active time (wall clock was 1m 48s);
  - Workout Activities: four rows, all "Running";
  - Workout Events: Pause 00:00:45 and Resume 00:01:05;
  - the route map;
  - Total Walking + Running Distance 0.3 km, matching the app.
  - Each activity's details list its own duration, start, end and distance. The custom kind is not
    shown.
- **Before the distance split,** the same shape read 0.24 km against 0.29 km written. HealthKit
  spreads a sample evenly over active time, so the paused share fell out of the total.
- **Probe:** a `.walking` activity in a running workout was refused (`errorInvalidArgument`). The
  plain fallback saved the workout, and the JS warning fired.
- **Re-save** (`resaveLatestRunToHealth()`), checked on a paused run after the distance split and
  the review round: one workout at the new sync version, one route, and both distance rows (0.15 and
  0.14 km), with no duplicates.
- **The narrowed fallback** still catches the probe's refusal: a plain workout was saved and the
  warning fired.

## Found in review (2026-10-01)

Four reviewers looked at the Swift module (against the SDK headers and the expo-modules-core
sources), the TypeScript (200k fuzz cases), ADR compliance and comment density. None found a
Critical. Fixed:

- **The route** used a separate `HKWorkoutRouteBuilder` and `finishRoute`, which
  `HKWorkoutRouteBuilder.h` says not to do alongside a workout builder. It now uses
  `seriesBuilder(for:)` and commits with the workout.
- **The fallback** caught an invalid argument from any step, so an unrelated error could replace a
  good workout with a plain one and still fail. It now covers only the intervals and pauses.
- **A relock retry** could spend all three attempts in milliseconds while the flag still read
  available. Each retry now waits for a fresh signal. Sync versions step by two per attempt, so a
  plain fallback and the next attempt never share one.
- **A distance part could be a hair below zero** (≈ −1e-13 m when the last stretch had no route),
  which could fail every save of that run. Parts are now clamped, and empty ones are dropped.
  Pauses are sorted and clamped inside the split.
- **Native hardening**, following the Expo Modules guidance: the segment kind is an `Enumerable`
  enum and the result a `Record`. The background task now has an expiration handler. A committed
  workout is no longer discarded. Each wait no longer leaks a retain cycle. A non-finite sync
  version is rejected rather than crashing. The plugin runs without options.
- **Docs:** ADR 0011's status and banner, the retry count, the per-interval distance wording, the
  type-only import, ADR 0026's module name and duration change, and H2's grace period.

Not changed:

- Per-interval distance and pace stay spread over each stretch (the owner's choice).
- The route weights use raw GPS, so jitter skews only how a total is split, never the total itself.
- `requireNativeModule` stays at the top level, so a JS-only repack onto an older binary fails at
  launch, as with expo-maps.

## Best-practice review (2026-10-01)

Two more reviewers, at the owner's request ("all native work … reviewed with Expo Modules best
practices and Apple best practices for its purpose"): one against the `expo:expo-module` skill,
the SDK 57 local-module template and first-party modules, one against Apple's HealthKit
documentation, the SDK headers, the HIG and App Review §5.1.3. Changed:

- **No unlock wait.** HealthKit caches locked writes, and with the series-builder route a nil
  `finishWorkout` is a save. The wait was unbounded, and killing the app during it lost the save.
- **One distance sample per interval**, so each interval has its own pace (see above).
- **HealthKit error codes reach JS.** Required record fields. An exceptions file. The authorization
  status is an `Enumerable`. `Int64(exactly:)`. The expiration handler uses
  `MainActor.assumeIsolated`. The plugin uses `createRunOncePlugin` and has a JSDoc type.
- **Metadata:** `IndoorWorkout = false`, the time zone, and the device on the distance samples.
- **Data:** distance samples go last, stale ones are deleted first, low-accuracy route points are
  filtered, and a missing altitude is marked invalid.
- **The onboarding copy** no longer promises "your rings": no energy is written, so a third-party
  workout does not move them.

Simulator, after this round:

- A paused plan run shows a duration of 1m 27.49s (active time), Time Zone (Central European Summer
  Time), Indoor Workout No, 0.3 km from four per-interval rows, the route, four activities and the
  pause.
- A re-save left one workout and the same four rows.

Not changed:

- The sync version stays `Date.now()`. A per-run counter would guard against a clock set back, a
  rare case.
- The permission is still asked in onboarding as well as from the summary.
