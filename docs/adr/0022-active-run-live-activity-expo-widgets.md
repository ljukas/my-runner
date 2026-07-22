# 22. Active-run Live Activity via first-party expo-widgets, updated locally

> **iOS-only atm** — Live Activities are an iOS capability with no Android
> equivalent; the port below is iOS-only by nature (see [ADR 0020](0020-ios-only-android-deferred.md)).

Date: 2026-07-22

## Status

Proposed — decided in principle; **implementation gated on all five v1 delivery
stages ([spec §13](../superpowers/specs/2026-07-11-c25k-app-design.md)) being
complete.** Research: [2026-07-22 iOS Live Activities](../superpowers/research/2026-07-22-ios-live-activities.md).

## Context

The flagship scenario (spec §6, [ADR 0008](0008-background-execution-location-heartbeat.md))
is a locked phone in a pocket. Today a run in that state is invisible until you
find and open the app. A Live Activity mirrors the active **Run** onto the Lock
Screen and Dynamic Island — obvious that a run is going, one tap to return.

The spec deferred this to v2 and named the path: *"Live Activity / Dynamic Island
(official `expo-widgets`; engine already event-driven so `update()` on segment
change is a bolt-on)"* (spec §14). The research doc turned that into a decidable
assessment; this ADR commits to its recommended approach (Option A) and records
the design.

**What already exists** (the seams this plugs into):

- The **run engine** (event-log state machine, [ADR 0007](0007-run-engine-event-log.md))
  exposes a subscribable `RunSnapshot` with `segmentKind`, `segmentIndex`,
  `segmentSecondsRemaining`, `segmentEndsAt` (epoch-ms), `nextSegment`,
  `activeElapsedSeconds`, `totalSeconds` — an ideal data source.
- The engine fires a cue on **derived-segment change** (`announceProgress`),
  through the injected `CueService` port ([ADR 0009](0009-cue-audio-tts-prerecorded-fallback.md)).
- While locked, JS is kept alive ~1 Hz by the location heartbeat (ADR 0008) —
  the *only* thing running; the view layer is suspended.
- UI is authored in **@expo/ui SwiftUI islands** ([ADR 0005](0005-system-native-ui-expo-ui.md));
  platform capabilities sit behind **ports & adapters** ([ADR 0003](0003-platform-ports-and-adapters.md)).

**Research findings (verified 2026-07-22; full citations in the research doc):**

- **`expo-widgets` is first-party and stable** since Expo SDK 56, version-matched
  to our SDK 57 line, `platforms: ['ios']`, dev-build only (we use expo-dev-client).
- **`createLiveActivity(name, component)`** registers the Lock Screen + Dynamic
  Island layout **at runtime** (not in the config `widgets` array); the layout is
  authored in `@expo/ui/swift-ui` under a `'widget'` directive and returns
  `banner` / `compactLeading` / `compactTrailing` / `minimal` / `expanded*`
  regions. The instance API is `start(props, url?)` → `instance.update(props)`
  → `instance.end(dismissalPolicy, props, contentDate)` — immediate ActivityKit
  updates.
- **Live Activities do *not* use widget timelines.** `expo-widgets` also exposes
  a home-screen-**widget** timeline API (`updateSnapshot` / `updateTimeline` /
  `getTimeline`, WidgetKit's TimelineProvider); that surface is out of scope
  here. A Live Activity refreshes only via immediate `update()` calls plus the
  self-rendering timer text — no timeline scheduling.
- **A countdown self-renders with no code running:** `@expo/ui/swift-ui`'s
  `<Text timerInterval={{ lower, upper }} countsDown />` (iOS 16.0+) ticks in the
  OS. Only *discrete* changes (our walk↔run label) need an `update()`.
- **Local updates are the default;** APNs is opt-in behind
  `enablePushNotifications: true` (`getPushToken()` / `addPushTokenListener()`),
  left off keeps everything in-app.
- **iOS floor 16.1** (Lock Screen all iPhones ≥16.1; Dynamic Island iPhone 14
  Pro+) — far below our effective floor (iOS 18 map floor, [ADR 0010](0010-maps-expo-maps-ios18-floor.md);
  targeting iOS 26), so availability is a non-issue.
- **New native surface required:** a widget-extension target, an **App Group**
  entitlement, and **`NSSupportsLiveActivities = YES`** in the *app's* Info.plist
  (activities fail silently without it) — none present today.
- **Maturity:** `expo-widgets` is **stable** (SDK 56+, no alpha/beta/experimental
  banner). The one notable reported bug — blank widgets when the JS runtime bundle
  isn't copied into the extension ([expo/expo#43646](https://github.com/expo/expo/issues/43646))
  — was SDK 55, closed *incomplete*; an early-version build-config issue, not an
  SDK-57 blocker. A device spike is standard diligence for a new widget-extension
  target, not a sign of instability.

## Decision

Build the active-run Live Activity as research **Option A**: first-party
`expo-widgets`, updated **locally**, behind a new **LiveActivity port**.

1. **A `LiveActivity` port (ADR 0003 seam), injected into the run engine like
   `CueService`.** `services/live-activity/port.ts` (types only) +
   `adapter.ios.ts` (the `expo-widgets` implementation) + `index.ts`. The engine
   and screens import only the port; nothing outside `services/live-activity/`
   touches `expo-widgets`, preserving the engine's purity (ADR 0007). Interface
   stays narrow — roughly `start(snapshot)`, `update(snapshot)`, `end()` — a deep
   module: a tiny surface over substantial machinery (widget layout, App Group,
   activity lifecycle). Deletion test: removing it would scatter `expo-widgets`
   calls across the engine and screens — it concentrates complexity, so it earns
   its place.

2. **The engine owns the seam, because only the engine is alive while locked.**
   The segment-change `update()` fires from the engine's derived-segment-change
   point — the same point `CueService.announce()` fires (ADR 0009) — so "on
   segment change, tell the world" lives in one place (locality). This is not
   merely tidy: while the phone is locked the view layer is suspended and only
   the engine heartbeat (location-driven, ADR 0008) runs, so an update driven
   from anywhere but the engine would silently stop refreshing in exactly the
   flagship scenario. Lifecycle mapping: `start()` on run start (foreground);
   `update()` on derived-segment change and on pause/resume/skip; `end()` on
   completion / end-early / abandon / reset.

3. **The countdown self-renders; `update()` is event-sparse.** The banner and
   Dynamic Island show `<Text timerInterval countsDown />` seeded from
   `RunSnapshot.segmentEndsAt`, so the per-second tick needs no JS. `update()`
   fires only on discrete state changes (~every 60–90 s at segment boundaries),
   reseeding the timer. This is what makes locked-phone freshness cheap and
   honest — not a fake 1 Hz background refresh (the pattern App Review rejects).

4. **Local updates only.** `enablePushNotifications` stays **false** — no push
   tokens, no APNs, no push server, no backend. The App Group shared store is
   on-device. Holds every `AGENTS.md` hard constraint (no backend/accounts/
   analytics; on-device + iCloud).

5. **Graceful degradation mirrors ADR 0008.** Location denied → no background
   heartbeat → segment-label `update()`s don't fire while locked, but the timer
   still ticks (OS-rendered) and the label catches up on foreground — the same
   honest degradation already documented for cues, with no new coupling. On
   hardware without a Dynamic Island the Lock Screen presentation is used; below
   iOS 16.1 (effectively no user) no activity starts. All runtime-gated.

6. **Native config via config plugin (CNG, ADR 0003 §CNG; wired per [ADR 0019](0019-app-variants-dynamic-config.md)).**
   The `expo-widgets` plugin goes in the `app.config.ts` `plugins` spread; it
   generates the widget-extension target and injects the App Group entitlement
   (`group.se.lukaslindqvist.runbro`, made variant-aware alongside the ADR 0019
   identity fork) and `NSSupportsLiveActivities` into the app Info.plist. The
   `createLiveActivity` layout is registered at runtime, not in the config
   `widgets` array. Adding the native target **changes the `@expo/fingerprint`
   hash → a native build, not an OTA update** — coordinate the adopting release
   with [ADR 0012](0012-release-please-fingerprint-gated-releases.md).

7. **A device spike gates the build.** Before any screen work, a release-config
   dev build must `start`/`update`/`end` a trivial Live Activity and confirm it
   renders on a **locked physical device** — the standard verification for any new
   widget-extension target (and confirmation the SDK-55-era #43646 bundling bug is
   past), exactly as Milestone 0 (spec §10) gates Stage 3. If the first-party path
   proves too rough, fall back to `@bacons/apple-targets` (research Option B); it
   is **pre-approved as a community-tooling exception**, priced the same way
   react-native-maps is in ADR 0010, so the fallback is not re-litigated.

8. **Implementation is deferred until all five v1 stages are complete (spec
   §13).** Rationale: the segment-change `update()` path rides the ADR 0008
   background heartbeat, which only lands in Stage 3; the feature is explicit v1
   out-of-scope polish (spec §14); and it perturbs the fingerprint/release story
   (ADR 0012), best exercised against a stable shipped v1. The Live Activity is
   purely additive — no engine, schema, or screen rework — so it slots in after
   v1 without disturbing the shipped app. A phased plan may ship the timer-only
   activity first (research Option C — no heartbeat dependency), then add
   segment-label updates.

## Consequences

- The engine gains one more injected port, symmetric with `CueService`: the
  derived-segment-change seam now has two subscribers (audio + Live Activity),
  both firing from one point. New behavior is a port swap, not engine surgery.
- The locked-phone path reuses ADR 0008's heartbeat wholesale — **no new
  background mechanism, no new wakeups, no new permission.** Battery cost is
  negligible: the OS renders the timer; `update()`s are boundary-sparse.
- Fully local — no backend, push server, account, or analytics is introduced;
  `AGENTS.md` intact and the local-first line held.
- A widget-extension target + App Group + Info.plist key bump the fingerprint, so
  the first release after adoption is a **native build, not OTA** (ADR 0012); App
  Group provisioning is handled through EAS.
- The port interface is the test surface: the engine is unit-tested against a
  fake `LiveActivity` adapter (`bun test`), no `expo-widgets` mock. The activity
  itself is **not Maestro-testable** (like audio and HealthKit) → a manual device
  checklist per the spec §10 / ADR 0008 pattern.
- iOS-only by nature (ADR 0020); an Android pass would decide the adapter's shape
  separately (no Live Activity equivalent — likely a no-op or a foreground-service
  notification), isolated behind the same port.
- The library is stable, so integration risk is the ordinary new-native-target
  kind (signing, App Group, bundling) — owned by the device-spike gate plus the
  pre-approved `@bacons/apple-targets` fallback, the same risk posture as expo-maps.

## Alternatives considered

- **Community `@bacons/apple-targets` + hand-written SwiftUI widget + a bespoke
  local native module (research Option B)** — rejected as the default: community
  tooling against the official-tooling preference, and more hand-written Swift +
  a native module to maintain. Retained as the **pre-approved fallback** if the
  `expo-widgets` device spike fails (react-native-maps precedent, ADR 0010).
- **ActivityKit push-driven updates (`enablePushNotifications: true` + APNs + a
  push server)** — rejected: requires a backend to hold tokens and send updates,
  a direct violation of the no-backend constraint. Fails the local-first lens,
  not feasibility.
- **Driving the Live Activity from the run screen instead of the engine** —
  rejected: while locked the view layer is suspended; only the engine heartbeat
  runs (ADR 0008), so an update located in the view would silently stop refreshing
  in the flagship locked-phone scenario. The seam must be the engine's
  derived-segment-change point.
- **Timer-only activity with no background segment updates (research Option C)** —
  not rejected: folded in as an optional **phase 1** of this decision (it drops
  the heartbeat dependency), to be settled in the staged plan, not as a separate
  ADR.
- **A live route map on the Live Activity** — out of scope, consistent with the
  run screen's "no live map in v1" call (spec §8): battery and glanceability. The
  activity shows the timer and segment, not a map.
- **Building this inside v1 (before Stage 5)** — rejected: it depends on the
  Stage-3 background heartbeat, is spec-designated out-of-scope polish, and would
  entangle the fingerprint/release story before v1 has shipped.

