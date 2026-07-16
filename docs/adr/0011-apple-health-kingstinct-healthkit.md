# 11. Apple Health writes via @kingstinct/react-native-healthkit

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

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

1. **Port contract (ADR 0003):** `isAvailable()`, `requestWriteAccess()`,
   `saveRun(run, segments, points)` — callers never see HealthKit types.
   The iOS adapter is the only file importing the library.
2. **Write-only authorization:** `toShare: [workout, workoutRoute,
   distanceWalkingRunning, activeEnergyBurned]`, no read permissions ever.
   The privacy story stays minimal: the app writes measurements it made; it
   collects nothing.
3. **Plugin configuration (load-bearing):** `NSHealthUpdateUsageDescription`
   with the spec's purpose string, and **`background: false`** — without it
   the plugin adds a background-delivery entitlement and AppDelegate
   modification the app must not carry.
4. **Save flow (local-first, never blocking):** the run is fully saved to
   SQLite *before* any Health call (ADR 0004); then, non-blocking:
   `saveWorkoutSample` → `proxy.saveWorkoutRoute(locations)`. Success sets
   `healthkit_saved`; failure leaves the flag unset with a retry affordance
   on the run detail screen. Denial is respected silently — the Settings
   toggle simply stays off.
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
  `expo-modules-core` Swift module owned in-repo, CNG-compatible. Rejected:
  write-only workout + route saving still means owning HKWorkoutRouteBuilder
  semantics, auth flows, and yearly iOS HealthKit churn for zero product
  difference — a standing maintenance tax against a healthy, pinned,
  port-boxed dependency. Revisit only if the library dies.
- **Defer Health to v2** — rejected: it is Stage 5's core value and one of
  the cheapest paid-app-parity wins the app has, precisely because it is
  boxed behind a port and non-blocking.
- **Read/write integration** (import workouts, show Health data) — rejected
  for v1 and the foreseeable future: reading multiplies the privacy surface,
  the App Review burden, and the 5.1.3 mirroring constraints, for features
  the product does not need.
