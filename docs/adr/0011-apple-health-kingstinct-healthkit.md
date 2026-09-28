# 11. Apple Health writes via @kingstinct/react-native-healthkit

> **Android: stage 5 (Health Connect) — built 2026-09-22.** Android ships in stages ([ADR 0025](0025-android-staged-migration.md)); the Health Connect adapter and the three Android UI surfaces shipped in stage 5. See the [Amendment (2026-09-22)](#amendment-2026-09-22-android--health-connect-behind-the-same-port) for where Decision item 7's "designed against both APIs' shapes" needed correcting.

Date: 2026-07-11

## Status

Accepted, **amended 2026-08-01** on shipping the Stage 5 Health slice — see
[Amendment (2026-08-01)](#amendment-2026-08-01). `activeEnergyBurned` is dropped
from the write set, the Settings toggle is a reporting row, and the retry lives
on `runs/[runId]` — corrected in place below. Decision item 5's per-segment
distance samples were also corrected in place, on a second look at the same
Health slice the same day: they fragmented the user's distance history rather
than conveying structure, and the workout now writes a single whole-session
sample instead — see amendment item 7. Research findings under Context
are left as the dated 2026-07-11 record of what was believed then, and the
amendment says where they were wrong or incomplete.

## Context

Stage 5 (spec §9, §13) writes completed runs — duration, distance, energy,
and the full GPS route — to Apple Health. HealthKit is the only capability in
the app with **no official Expo module**, and it is iOS-only by nature, which
makes it both the strongest case for the `HealthAdapter` port (ADR 0003) and
an unavoidable exception to the official-tooling policy.

Research findings (verified 2026-07-11 against the library's master branch
and npm):

- **@kingstinct/react-native-healthkit is active and stack-compatible:**
  14.0.2 published June 2026; peer deps `react >= 19`, `react-native >=
  0.79`, `react-native-nitro-modules >= 0.35` — all satisfied by this app
  (React 19.2, RN 0.86). It is New-Architecture-native (Nitro).
- **The save surface exists as the spec described:** `saveWorkoutSample` in
  the Nitro spec, `saveWorkoutRouteInternal` in `WorkoutProxy.swift`
  (HKWorkoutRouteBuilder under the hood — the full CLLocation route lands in
  Apple Health).
- **The limitation is real and hardcoded:** `workoutEvents: nil` appears at
  three construction sites in `WorkoutsModule.swift` — workout pause/segment
  *events* cannot be written through this library. The interval structure
  cannot be represented natively in the Health workout.
- **A default that must be overridden:** the config plugin **enables
  HealthKit background delivery by default** — adding the
  `com.apple.developer.healthkit.background-delivery` entitlement *and* an
  AppDelegate modification unless `background: false` is passed
  (`app.plugin.ts`, verified). A write-only integration wants neither.
  The plugin is otherwise standard `@expo/config-plugins` (entitlements +
  purpose strings) — fully CNG-compatible.
- **The alternative is dead:** react-native-health was last published
  October 2024 (~21 months stale against two React Native architecture
  generations).
- App Review 5.1.3 requires a privacy policy for HealthKit apps and permits
  writing only genuinely measured data.

## Decision

**Apple Health integration is write-only, via @kingstinct/react-native-healthkit
v14 (+ react-native-nitro-modules), fully boxed behind the `HealthAdapter`
port.**

1. **Port contract (ADR 0003):** `getAuthorization()`, `requestWriteAccess()`,
   `saveRun(input)` — one pre-built `HealthWorkoutInput` payload assembled by
   `domain/health.ts`'s `toHealthWorkout(run, fixes)`, not positional
   arguments; callers never see HealthKit types. The iOS adapter
   is the only file importing the library. (Corrected 2026-08-01 — an
   `isAvailable()` member was dropped; see the amendment. `toHealthWorkout`
   originally also took a `segments` argument, dropped along with the
   per-segment samples in amendment item 7.)
2. **Write-only authorization:** `toShare: [workout, workoutRoute,
   distanceWalkingRunning]`, no read permissions ever. (Corrected 2026-08-01 —
   `activeEnergyBurned` was dropped; see the amendment.) The privacy story
   stays minimal: the app writes measurements it made; it collects nothing.
3. **Plugin configuration (load-bearing):** `NSHealthUpdateUsageDescription`
   with the spec's purpose string, and **`background: false`** — without it
   the plugin adds a background-delivery entitlement and AppDelegate
   modification the app must not carry.
4. **Save flow (local-first, never blocking):** the run is fully saved to
   SQLite *before* any Health call (ADR 0004); then, non-blocking:
   `saveWorkoutSample` → `proxy.saveWorkoutRoute(locations)`. Success sets
   `healthkit_saved`; failure leaves the flag unset with a retry affordance
   on the run summary (`runs/[runId]`). (Corrected 2026-08-01 — the run
   detail screen this originally named was never built; see the amendment.)
   Denial is respected silently — the Settings row simply reports the
   current status, since iOS never lets an app revoke its own grant.
5. **Interval-structure workaround — corrected 2026-08-01, see the
   amendment.** Since `workoutEvents` is not writable, the original decision
   attached one `DistanceWalkingRunning` quantity sample per segment to
   approximate the structure. In practice this did not convey structure —
   HealthKit has no way to label a sample walk-vs-run, so the samples just
   fragmented the user's distance history — and the workout now carries a
   single whole-session distance sample instead. The app's own DB remains
   the source of truth for intervals. If the library ever exposes workout
   events, enriching the save is an adapter-only change.
6. **App Review 5.1.3 compliance:** only real measured values are written;
   a privacy policy URL ships with Stage 5; HealthKit-derived data is never
   mirrored into any future export or sync payload (trivially satisfied —
   the app writes to Health and reads nothing back).
7. **Android later:** Health Connect via `react-native-health-connect`
   behind the same port — the port signature was designed against both
   APIs' shapes (spec §7).

## Consequences

- The app's ecosystem story ("your runs appear in Apple Health with their
  route") ships without native code ownership: the plugin manages
  entitlements under CNG, and the Nitro library carries the HealthKit
  surface.
- This is the second standing exception to the official-tooling policy
  (after the react-native-maps *fallback*, ADR 0010) — and the first in the
  primary path. Priced and contained: no official Expo module exists, the
  library is actively maintained and New-Arch-native, the version is
  pinned, and every import sits in one adapter file behind the port.
- `react-native-nitro-modules` enters the dependency tree — the app's first
  Nitro dependency. Accepted: it is the library's runtime, installed at the
  Expo-compatible version, and invisible outside the adapter.
- Health saves can never lose data or block completion: the local save
  precedes every Health call, and `healthkit_saved` + retry make eventual
  consistency user-driven rather than automatic (no background delivery, no
  silent retries — honest and simple).
- Apple Health will show the run as one continuous workout with distance
  samples, not as structured intervals — a platform-representation
  limitation (hardcoded in the library), documented so nobody chases it as
  a bug. The in-app history remains the richer record.
- Write-only scope keeps the App Privacy label at "data not collected" and
  the 5.1.3 conversation short; the privacy policy URL is the one piece of
  release collateral this ADR adds to Stage 5.

## Alternatives considered

- **react-native-health** — rejected: last published October 2024, predating
  the New Architecture the app runs on; adopting an unmaintained bridge for
  the health-data path is the worst place to accept staleness.
- **A custom local Expo Module (Swift)** — the policy-pure option: a small
  `expo-modules-core` Swift module owned in-repo, CNG-compatible. Rejected for
  v1: write-only workout + route saving still means owning
  HKWorkoutRouteBuilder semantics, auth flows, and yearly iOS HealthKit churn
  for zero product difference — a standing maintenance tax against a healthy,
  pinned, port-boxed dependency. **No longer "revisit only if the library
  dies"** — see Amendment (2026-08-01) item 2: this is now the documented
  escape hatch for structured intervals, since the library's stance on
  `HKWorkoutEvent`/`HKWorkoutActivity` hasn't moved.
- **Defer Health to v2** — rejected: it is Stage 5's core value and one of
  the cheapest paid-app-parity wins the app has, precisely because it is
  boxed behind a port and non-blocking.
- **Read/write integration** (import workouts, show Health data) — rejected
  for v1 and the foreseeable future: reading multiplies the privacy surface,
  the App Review burden, and the 5.1.3 mirroring constraints, for features
  the product does not need.

## Amendment (2026-08-01)

Written on shipping the Stage 5 Health slice. Sources are the design spec
[2026-07-31-stage-5-apple-health-design.md](../superpowers/specs/2026-07-31-stage-5-apple-health-design.md)
§3, §3.1, §4, §5.3, §7.2 and §11, re-verified against the published `14.0.2`
tarball and the library's `master` branch, plus manual verification on the
simulator on 2026-08-01. Decision items 2 and 4 and Alternatives item 2 above
are corrected in place; this section explains where and why.

1. **`activeEnergyBurned` is dropped from the write set.** The app has no
   heart rate and, being write-only, can never read body mass — any kcal
   figure attached to a workout would be fabricated, which App Review 5.1.3
   forbids. Duration, distance and route only.

2. **Apple's interval representation is blocked upstream, on `master` too —
   so owning a small native module moves from "rejected" to the documented
   escape hatch.** `workoutEvents: nil` is hardcoded at all three
   `HKWorkout.init` call sites (`WorkoutsModule.swift:156,169,184`), unchanged
   on `master`; `activities` exists only as a read-only getter
   (`WorkoutProxy.swift:368`). The library has not moved in the direction this
   ADR hoped for when it deferred the custom-module alternative. That
   alternative is no longer priced as "revisit only if the library dies" — it
   is what to reach for if structured intervals in Health are ever worth the
   maintenance tax.

3. **Two traps in the save path, load-bearing for anyone touching
   `adapter.ios.ts` again.** `totalDistance` is overwritten by *every*
   metre-compatible sample passed to `saveWorkoutSample`
   (`WorkoutsModule.swift:116-117`), so `totals.distance` is not optional
   whenever segment samples are passed — omit it and the workout's total
   silently becomes the last segment's distance, not the run's. And
   per-sample metadata is discarded in favour of the workout-level map
   (`:133`), so segment kinds cannot be tagged on individual samples, only on
   the workout as a whole.

4. **Two API-shape facts worth recording precisely, since Context7's
   generated docs for this library get both wrong** (AGENTS.md carries the
   general warning). `WorkoutActivityType` is a numeric enum, not a string
   union — `WorkoutActivityType.running` is a number, not `"running"`. And
   the metadata keys HealthKit actually serializes are the string literals
   `HKSyncIdentifier` / `HKSyncVersion`, not the `HKMetadataKey…` names —
   those are only Apple's Swift constant names; the library's own README says
   the two differ, and only the raw string works in the metadata map the
   adapter builds.

5. **The plugin writes `NSHealthShareUsageDescription` unconditionally, with
   no opt-out** (`app.plugin.ts:44-47`) — omit it and the plugin injects a
   read-access purpose string into Info.plist for an app that never reads. A
   local config plugin, registered before the library's own plugin in the
   array (mods chain in registration order), strips it.

6. **The duplicate-workout risk this ADR left open is now closed by
   construction, with one half still unverified.** `saveRun` tags the workout
   and every per-segment sample with `HKSyncIdentifier` / `HKSyncVersion`
   metadata keyed on the run id, the version stamped fresh via `Date.now()`
   on every call. That last part is load-bearing, not incidental: `HKMetadata.h`
   only replaces a stored object under a repeated sync identifier when the new
   save's version is strictly *greater* than what's stored — a version fixed
   across releases (as this originally shipped, tagged `1` unconditionally)
   can never satisfy that on a retry within the same release, so the replace
   path would never fire. With a version that increases on every save, a
   retry after a partial failure replaces the workout instead of duplicating
   it, as HealthKit documents for a repeated sync identifier. That raised a
   question the implementation first flagged as unverified: since every per-segment sample now carries
   the *same* identifier as the workout and each other, would HealthKit
   collapse them into one? **Verified on the simulator (2026-08-01): no** —
   all 17 samples from a real multi-segment run survived individually,
   visible in Health's own "Show All Data" list, and the workout total
   matched the app's summary. What remains unverified is the other half —
   that a genuine retry replaces rather than duplicates the *workout* —
   because the summary's button hides once a run is saved, leaving no UI path
   to a second save attempt on the same run. See the design spec's §11 Risk 1
   for the honest status.

7. **Decision item 5 reversed: per-segment samples fragment the user's
   distance history rather than convey structure.** Item 6's verification
   that all 17 per-segment samples survive individually — rather than
   collapsing under the shared sync identifier — was read at the time as
   reassurance that the mechanism worked. Inspecting the *result* in the
   Health app on 2026-08-01 showed what that verification actually cost:
   those 17 samples appear as 17 separate rows in Walking + Running Distance
   → All Recorded Data, each a one-second, ~5.6 m entry (confirmed in
   Health's sample detail: start 12:47:08, end 12:47:09, 5,6 m) — permanent,
   user-visible clutter in a system data list, not interval structure.
   HealthKit has no way to label a `DistanceWalkingRunning` sample
   walk-vs-run, so the samples never conveyed the structure item 5 hoped for;
   they only fragmented it. `saveRun` now writes a single distance sample
   spanning the whole run — its window is the run's own start/end, aligned
   with the workout, and its value the run's total distance — kept, rather
   than dropped entirely, because a sample (not just the workout's own
   `totalDistance`) is what makes a run appear in the user's distance history
   and count toward their totals. Item 6's sync-identifier mechanics are
   unaffected: one sample tagged with the run id behaves exactly as N did.

## Amendment (2026-09-22): Android — Health Connect behind the same port

Written on shipping Android stage 5 (ADR 0025 row 5), verified on the shared
emulator (Pixel 9 Pro, Android 16, platform Health Connect) the same day. The
plan is [`2026-09-22-android-stage-5-health-connect.md`](../superpowers/plans/2026-09-22-android-stage-5-health-connect.md).

1. **`react-native-health-connect` 4.1.3 is the Android half**, as Decision
   item 7 pre-approved, with its bundled Expo module registering the permission
   delegate (no `MainActivity` edit) and its config plugin adding only the
   rationale intent filters. The write permissions
   (`android.permission.health.WRITE_EXERCISE`, `WRITE_EXERCISE_ROUTE`,
   `WRITE_DISTANCE`) go in `android.permissions`, and `expo-build-properties`
   raises `minSdkVersion` to 26 (SDK 57 defaults to 24; `connect-client:1.1.0`
   requires 26). **Three files reference the library, not one:** two runtime
   imports — `health/adapter.android.ts` and `health/open-health-app.android.ts`
   (Health Connect's settings are an intent the library wraps,
   `ACTION_HEALTH_CONNECT_SETTINGS`; never a port member on iOS either) — and one
   type-only import in the pure, unsuffixed `health/health-connect.ts`, erased at
   runtime, which is why that file resolves on iOS too. All three sit inside
   `services/health/`, the containment boundary ADR 0003 enforces. The version
   is pinned exactly (`4.1.3`), like the HealthKit library, because the mapper
   restates three of its numeric constants.
2. **Item 7's "designed against both APIs' shapes" was true of the payload and
   false in three places, each absorbed on the Android side so iOS is untouched:**
   - `getAuthorization()` is synchronous and every Health Connect status call is
     async. The Android adapter **caches a probed status** — probed at module
     load, after every `requestWriteAccess`, and on every AppState `active` —
     and calls `notifyAuthorizationChanged` when the answer changes. The
     listener `Set` moved from the hook module to `authorization-events.ts`
     (the hook re-exports it) so the adapter can import it without a cycle. The
     cache starts `'unavailable'` so nothing is offered or written before the
     first probe resolves, which happens during startup.
   - `domain/health.ts` is Apple-shaped (`CL_UNKNOWN = -1`). Health Connect
     rejects a negative accuracy, requires route times to satisfy
     `start ≤ t < end` and to be strictly increasing (`ExerciseSessionRecord.kt`,
     `ExerciseRoute.kt`), and the library's writer **throws `InvalidLength` when
     any of `horizontalAccuracy`/`verticalAccuracy`/`altitude` is absent**
     (`ReactExerciseSessionRecord.parseWriteRecord` calls `getLengthFromJsMap`
     unconditionally — the TypeScript `?` is a lie for writes). The pure,
     `bun test`-ed `health/health-connect.ts` therefore filters and de-duplicates
     the route, always emits all three lengths, and writes an unknown accuracy
     as `0` m — Android's own `Location` convention for "not available".
   - `HKSyncIdentifier`/`HKSyncVersion` become `clientRecordId` /
     `clientRecordVersion` (`Date.now()`, same reasoning as item 6). The
     distance record is keyed `${runId}:distance`. **Verified:** saving the same
     run twice left one session and one distance entry in Health Connect.
3. **"Denied" is the app's own memory.** Health Connect exposes only granted
   permissions; a missing grant reads as `'notDetermined'` until the app has
   asked once (`health.writeAccessRequested` in the kv-store) and `'denied'`
   after, and a partial grant is `'denied'` (the session is not written without
   its route and distance permissions). Google's guidance says a twice-cancelled
   request is auto-declined afterwards, so the denied row sends the user to
   Health Connect rather than re-prompting.
4. **The rationale link kills the dialog.** The permission dialog's privacy
   policy link fires `ACTION_SHOW_PERMISSIONS_RATIONALE` (≤ 13) or
   `VIEW_PERMISSION_USAGE` (14+) at `MainActivity`, which is `singleTask`, so
   the dialog above it is destroyed and the pending request resolves with
   nothing granted — the same shape as *Don't allow*. Measured: the first build
   marked the user denied and advanced the primer for reading the policy. The
   adapter now treats an empty result that coincides with a rationale intent
   (allowing up to 1 s for it to reach JS) as still undetermined and persists
   nothing, and the Android primer stays on screen for an undetermined answer.
   The intent's action is read through `modules/launch-intent/` (the repo's
   second Android-only local module; React Native's `Linking` exposes only an
   intent's data URI, and these carry none) by one forked service seam,
   `subscribeHealthRationaleIntent` (`rationale-intent.android.ts`; the iOS
   file is a no-op), which the adapter and the shared `HealthRationaleGate`
   both subscribe to — the gate routes it to the new `privacy` screen, which
   Android Settings also links. The module has exactly one importer.
5. **UI:** `health-status-row.android.tsx`, `onboarding/health.android.tsx` and
   a Health Connect section in Android Settings are `.android` forks with
   Health Connect copy; the primer names the three data types written. Settings
   is a reporting row plus *Set up Health Connect* / *Open Health Connect* — no
   switch, because `revokeAllPermissions()` only takes effect after an app
   restart and Google's UX guidance sends users to Health Connect instead.
   `health-primer-v1` dropped `platforms: ['ios']`; the step order is shared.
6. **Verified on the emulator:** the primer → Health Connect's first-use intro →
   the dialog listing exactly Distance, Exercise, Exercise route → *Allow all* →
   Settings *Saving workouts*; a manual save of the 0.67 km fixture → a Running
   session with "Exercise map route available" and a 0.671 km Distance entry;
   the retry above; an auto-save on a fresh 40-second finish (0 m → session
   only, route attached); `pm revoke` of the three permissions → *Off* + *Open
   Health Connect* (opens Health Connect); `pm grant` → the foreground re-probe
   flips Settings back to *Saving workouts*. **Not exercised:** `SDK_UNAVAILABLE`
   and `SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED` (Health Connect is part of the
   platform on this image), an explicit *Don't allow*, and the twice-cancelled
   auto-decline.
