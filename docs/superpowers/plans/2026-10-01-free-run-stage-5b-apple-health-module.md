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
- **A locked finish writes once unlocked.** The wait lives in Swift, inside the save.
- **Full replacement:** the module owns every HealthKit call and has its own config plugin, and
  `@kingstinct/react-native-healthkit`, Nitro and `with-healthkit-write-only.js` go. The owner wants
  both health integrations owned, one at a time; Android follows in #90.
- **Distance is split at pauses**, one sample per stretch between them. It is not split per
  interval, which would fragment Health's distance history.

## Design

- **Native** (`modules/apple-health/ios/`):
  - `AppleHealthModule.swift` provides `isAvailable`, `authorizationStatus` (synchronous),
    `requestWriteAccess` and `saveWorkout`.
  - `WorkoutWriter.swift` drives `HKWorkoutBuilder`. It writes the distance parts, the pause/resume
    events, one `.running` activity per interval tagged `RunBroSegmentKind`, the sync metadata, then
    `finishWorkout`. The route comes from the workout builder's series builder and commits with the
    workout.
  - If HealthKit refuses the intervals (`errorInvalidArgument` from adding them or from
    `finishWorkout`), the writer saves a plain workout. A refusal from any other step fails the save.
  - If the phone relocks during a write, the writer waits for a fresh unlock signal and writes it
    all again, at most three attempts. Each attempt takes two sync versions: one for the structured
    write and one for its plain fallback.
  - It skips the distance or the route when the runner refused that type.
  - `ProtectedData.swift` waits for an unlock or for the app coming to the foreground.
- **Pure** (`bun test`): `services/health/healthkit.ts` maps `HealthWorkoutInput` to the wire
  payload (`modules/apple-health/types.ts`). It splits the distance at pauses, weighted by the route
  inside each stretch, or by time without a route, and gives the parts and the route their own sync
  identifiers.
- **Plugin:** `plugins/with-apple-health.js` sets the entitlement and the update purpose string,
  never the read string.
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
  | iOS unset             | `9d09364…` | `6b2ff87…` |
  | iOS `development`     | `4cf7631…` | `1255414…` |
  | iOS `e2e`             | `9419024…` | `01a889d…` |
  | Android unset         | `6bb185f…` | `97c2b27…` |
  | Android `development` | —          | `b0c4e49…` |
  | Android `e2e`         | —          | `c0d002d…` |

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
