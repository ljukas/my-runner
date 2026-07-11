# 8. Background execution: When-In-Use location as the locked-phone heartbeat

Date: 2026-07-11

## Status

Accepted

## Context

The app's flagship scenario (C25K design spec §6, Stage 3) is a locked phone
in a pocket: GPS tracking continues, the run engine keeps deriving segments,
and spoken cues keep playing over the user's music. Nothing in React Native
survives lock by itself — timers stop (ADR 0007) and the process suspends —
so something must legitimately keep the app alive. The spec bet on
When-In-Use location permission plus `UIBackgroundModes: [location, audio]`;
this ADR verifies that bet and resolves a contradiction and a gap found
during the evaluation pass.

Research findings (verified 2026-07-11):

- **Apple's model distinguishes continuation from launch.** Background
  location *continuation* of a session started in the foreground works with
  either When-In-Use or Always authorization, given the `location`
  background mode and `allowsBackgroundLocationUpdates = true`
  ([Apple: handling location updates in the background](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background),
  [allowsBackgroundLocationUpdates](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates)).
  **Always** is required only to *launch* a non-running app (significant
  location change, region monitoring, visits) — a capability this app does
  not need, since runs always start in the foreground.
- **expo-location implements exactly this** (verified in sdk-57 source):
  `startLocationUpdatesAsync` deliberately checks **only foreground
  permission** — the in-code comment distinguishes "background location
  service" from "user-initiated foreground service", relaxed by
  [expo#12594](https://github.com/expo/expo/pull/12594) (merged 2021) — and
  `EXLocationTaskConsumer.m` unconditionally sets
  `allowsBackgroundLocationUpdates = YES` and honors
  `showsBackgroundLocationIndicator`, `activityType`, and
  `pausesUpdatesAutomatically`. The v57 docs' generic "background location
  requires Always" statement describes the background-*launch* services and
  `requestBackgroundPermissionsAsync`; the continuation path is the
  implemented case this app uses.
- **A default that would silently break the app:** expo's task consumer
  defaults `pausesUpdatesAutomatically` to **true**. With
  `activityType: Fitness`, iOS may then pause updates when the user seems
  stationary (a long traffic light, a walk segment) — and a paused stream
  stops the JS heartbeat, which stops cues. Setting it `false` is
  load-bearing, not stylistic.
- **The heartbeat mechanism:** each background location delivery runs the
  module-scope TaskManager task headlessly (ADR 0003), executing JS ~1/s —
  this, not timers, is what drives `RunEngine.heartbeat()` while locked.
  Since iOS 16.4, sessions configured with *low* accuracy and distance
  filtering can be suspended in background; this app's configuration
  (BestForNavigation, `distanceInterval: 0`) is not in that class.
- **The audio background mode does not keep the process alive.** It permits
  the app's audio session to emit sound while backgrounded (the cue channel —
  ADR 0009); aliveness rides on location alone.

## Decision

**Locked-phone operation rides on When-In-Use background location; the app
never requests Always.**

1. **Modes and plugins:** `UIBackgroundModes: [location, audio]` via the
   `expo-location` plugin (`isIosBackgroundLocationEnabled: true`) and the
   `expo-audio` plugin (`enableBackgroundPlayback: true`). No native edits
   (CNG).
2. **Permission posture:** When-In-Use only, requested through the
   primer-before-prompt onboarding step (or just-in-time at first run
   start). Requesting Always is out of scope permanently — the app has no
   background-launch feature to justify it.
3. **Tracking configuration** (binding, per the research):
   `accuracy: BestForNavigation`, `activityType: Fitness`,
   **`pausesUpdatesAutomatically: false`** (expo defaults it true — see
   Context), `showsBackgroundLocationIndicator: true`,
   `distanceInterval: 0`, and **no deferred updates** — deferral batches
   deliveries, and delivery cadence *is* the cue heartbeat.
4. **Aliveness contract:** while locked, the engine heartbeat is the
   location event stream; in foreground, a 1 s `setInterval` supplements for
   UI smoothness. Nothing else (timers, audio session, silence loops) is
   relied on to stay alive.
5. **Location denied — honest degradation (supersedes spec §11's row):**
   the timer stays *correct* in all cases (wall-clock derivation, ADR 0007),
   but with location denied there is no background heartbeat, so **cues stop
   while the phone is locked**. The app says this plainly (run-screen banner:
   distance off, cues require the screen on), `useKeepAwake` supports
   screen-on running, and Settings deep-links to change the permission. No
   workaround is attempted.
6. **No keep-alive hacks:** playing silent audio to hold the process alive
   is rejected — it's the classic App Review 2.5.4 background-modes abuse,
   burns battery deceptively, and this app has a legitimate mechanism.
7. **Milestone-0 device gate stays** (spec §10): a release-configuration
   build on a physical iPhone validating 30+ min locked-phone GPS continuity
   and cue audibility before Stage 3 screens are built. Source verification
   lowers the GPS-continuation risk; real-device behavior remains the gate.
8. **App Review posture:** both background modes are genuinely exercised
   (run tracking; audible coaching cues) and justified in Review Notes;
   specific purpose strings; the background-location indicator stays on as
   an honesty feature.

## Consequences

- No Always prompt ever: better user trust, simpler App Review
  conversation, and the exact permission ceremony the primer pattern was
  designed for.
- The riskiest technical assumption in the spec is now verified at three
  levels — Apple's documented model, expo's permission gate, and the task
  consumer's `allowsBackgroundLocationUpdates = YES` — rather than assumed
  from a blog-level understanding. What remains for Milestone 0 is device
  reality (GPS quality, audio audibility), not API capability.
- Locked-phone cues are coupled to location permission. That coupling is
  physics (nothing else wakes JS), and it is now documented and surfaced in
  UX instead of being an undocumented surprise — the spec §11 error table
  must be corrected accordingly.
- The blue location indicator is always visible during runs. Accepted:
  it is accurate, and hiding it would require the Always posture this ADR
  rejects.
- Battery cost of BestForNavigation with no deferral for ~30–40 min
  sessions is accepted; deferral would trade cue latency for battery, the
  wrong trade for a coaching app.
- iOS's location stack keeps evolving (e.g. the newer CLServiceSession /
  liveUpdates generation); expo-location abstracts it, versions are pinned,
  and Milestone 0 re-validates per release.
- Android later: same port, different mechanics (foreground service +
  persistent notification via expo-location's Android config) — isolated in
  the `LocationTracker` adapter per ADR 0003.

## Alternatives considered

- **Always permission** — rejected: buys only background *launch*, which no
  feature needs; costs a scarier prompt, a heavier privacy story, and App
  Review scrutiny.
- **Silent-audio keep-alive loop** — rejected: background-mode abuse
  (guideline 2.5.4), deceptive battery drain, and unnecessary given a
  legitimate mechanism.
- **BGProcessingTask / background fetch** — rejected: scheduled,
  coarse-grained, and never continuous; cannot heartbeat a 1 Hz engine.
- **HKWorkoutSession-style workout keep-alive** — not applicable:
  `HKWorkoutSession` background execution is watchOS; iPhone apps get no
  equivalent process guarantee from HealthKit.
- **Foreground-only operation** (Stage 2's honest state) — rejected as the
  end state: it is precisely the paid-app-parity gap this stage exists to
  close; retained as the degraded mode when location is denied.
- **Deferred location updates for battery** — rejected: batching kills cue
  latency; the 1 Hz stream is the product, not overhead.
