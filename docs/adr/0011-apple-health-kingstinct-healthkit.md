# 11. Apple Health writes via @kingstinct/react-native-healthkit

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted, **amended 2026-08-01** on shipping the Stage 5 Health slice — see
[Amendment (2026-08-01)](#amendment-2026-08-01). `activeEnergyBurned` is dropped
from the write set, the Settings toggle is a reporting row, and the retry lives
on `runs/[runId]` — corrected in place below. Research findings under Context
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

1. **Port contract (ADR 0003):** `isAvailable()`, `getAuthorization()`,
   `requestWriteAccess()`, `saveRun(input)` — one pre-built
   `HealthWorkoutInput` payload assembled by `domain/health.ts`'s
   `toHealthWorkout(run, segments, fixes)`, not three positional arguments;
   callers never see HealthKit types. The iOS adapter is the only file
   importing the library.
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
5. **Interval-structure workaround:** since `workoutEvents` is not writable,
   per-interval `DistanceWalkingRunning` quantity samples are attached to
   approximate the structure; the app's own DB remains the source of truth
   for intervals. If the library ever exposes workout events, enriching the
   save is an adapter-only change.
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
   `adapter.ios.tsx` again.** `totalDistance` is overwritten by *every*
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
   metadata keyed on the run id, so a retry after a partial failure replaces
   the workout instead of duplicating it — HealthKit's documented behaviour
   for a repeated sync identifier. That raised a question the implementation
   first flagged as unverified: since every per-segment sample now carries
   the *same* identifier as the workout and each other, would HealthKit
   collapse them into one? **Verified on the simulator (2026-08-01): no** —
   all 17 samples from a real multi-segment run survived individually,
   visible in Health's own "Show All Data" list, and the workout total
   matched the app's summary. What remains unverified is the other half —
   that a genuine retry replaces rather than duplicates the *workout* —
   because the summary's button hides once a run is saved, leaving no UI path
   to a second save attempt on the same run. See the design spec's §11 Risk 1
   for the honest status.
