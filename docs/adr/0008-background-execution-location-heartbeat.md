# 8. Background execution: When-In-Use location as the locked-phone heartbeat

> **Android: stage 2 (location & background)** — Android ships in stages ([ADR 0025](0025-android-staged-migration.md)); the Android provisions below belong to stage 2 (location & background): the foreground-service heartbeat. Check ADR 0025's stage table for whether they have shipped.

Date: 2026-07-11

## Status

Accepted (§5's degraded mode amended 2026-07-28 to match the code, with the
honesty gap that leaves recorded as an open risk in Consequences).

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
   as soon as the display sleeps**. The run screen shows a banner — "Location
   is off" / "Distance and pace unavailable." — and Settings deep-links to
   change the permission. Screen-on running is available but **entirely
   user-driven**: the run screen's lock (ADR 0009 Decision 7) holds the
   display awake while it is on, and nothing turns it on automatically. No
   workaround is attempted.

   *Amended 2026-07-28 to match the code.* This clause previously promised an
   automatic keep-awake whenever location was not granted, and a banner that
   said cues require the screen on. Neither shipped: the display is held
   awake only while the lock is on, and the banner names only the measurable
   loss. The honesty gap that leaves is recorded as a named open risk in
   Consequences rather than quietly dropped.
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
- **With location denied, cues go silent when the screen sleeps — disclosed, not
  prevented.** Dropping the automatic hold created a real hazard: a runner who
  declined location and pocketed the phone would lose the coach without warning,
  precisely the undocumented surprise this ADR set out to avoid. It was raised as
  an open risk and closed the same day by disclosure.

  *Resolved 2026-07-28 via mitigation (a) — copy, not a forced hold.* The two
  strings that asserted the retired behaviour were corrected, so the Settings
  Location footer and the location primer both state that cues stop once the
  screen sleeps, and Settings points at the run lock. The run-screen banner now
  names the audible loss beside the measurable one — "Cues stop when the screen
  sleeps. Tap the lock to keep them playing." — so the warning arrives on the
  screen the runner is looking at when they start, naming the affordance that
  prevents it.

  **(b) was considered and rejected**: restoring an automatic hold whenever
  location is not granted is what the run-lock design spec originally specified,
  and the implementation dropped it on the ground that a forced screen-on run
  spends battery the runner never agreed to. Warning the runner and leaving them
  the lock keeps the trade where it belongs. §5's honesty promise is kept by
  disclosure rather than by overriding the runner — which is the same principle
  as decision 6's refusal of keep-alive hacks.
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

## Amendment (2026-09-20): Android stage 1 holds the display for the whole run

Decision item 5 and the rejected mitigation (b) — no automatic screen hold, the
runner keeps the lock as their own trade — are the iOS rule and stay so. Android
stage 1 ([ADR 0025](0025-android-staged-migration.md)) deliberately does the
opposite: `runHoldsScreenAwake(locked)` returns true for the whole run there,
because that stage has *no* heartbeat of any kind — no location stream and no
timer that survives the activity pausing — so a sleeping screen would not merely
silence cues, it would stop every segment boundary until the next foregrounding.
That is a different trade from iOS's "cues stop, timer stays correct", and it is
temporary: stage 2 brings the foreground-service heartbeat this ADR anticipated
for Android and reverts the hold to lock-only. The iOS branch of the helper is
`locked`, unchanged.

## Amendment (2026-09-21): Android mechanics realised (stage 2)

Android stage 2 ([ADR 0025](0025-android-staged-migration.md)) implements the
"Android later" note in Consequences. Same port, same permission posture,
different aliveness mechanism — measured on the Pixel 9 Pro API 36 emulator
with `expo-location` 57.0.7 / `expo-task-manager` 57.0.7.

- **The heartbeat is a foreground service.** `adapter.android.ts` starts
  `startLocationUpdatesAsync` with a `foregroundService` option; expo-location
  then runs its `LocationTaskService` as a `foregroundServiceType="location"`
  service, and each fix reaches the module-scope TaskManager task exactly as on
  iOS. The composition root is untouched. Screen-off measurement: 182 fixes in a
  190 s dark window, median gap 1.02 s, worst gap 2.04 s (one gap over 2 s); the
  two cues due in that window (`startRun`, `startWalk`) fired 0.2 s and 0.1 s
  after their scheduled instant while the app reported `background`. Doze never
  engaged in a 3 min window (`mState=INACTIVE`) — expected for a running
  foreground service, and not a substitute for the device gate.
- **Permission posture unchanged: foreground-only.** Only
  `ACCESS_FINE/COARSE_LOCATION` are requested (Android's "While using the app");
  `ACCESS_BACKGROUND_LOCATION` is neither declared nor requested, and
  `isAndroidBackgroundLocationEnabled` stays unset. The plugin adds
  `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_LOCATION` from
  `isAndroidForegroundServiceEnabled: true`. expo-location's module gates the
  foreground-service path on foreground permission only, and refuses to start it
  while the app is backgrounded — the engine only ever starts tracking from the
  run screen, so that constraint costs nothing.
- **`RECEIVE_BOOT_COMPLETED` is load-bearing, not optional.** expo-task-manager
  delivers every location batch through a *persisted* `JobScheduler` job
  (`setPersisted(true)`), and Android throws
  `IllegalArgumentException: Requested job cannot be persisted without holding
  android.permission.RECEIVE_BOOT_COMPLETED` on the first fix — a fatal crash of
  the whole process, repeated when the OS restarts the service. Nothing in the
  toolchain declares it (the task-manager config plugin is a no-op and its own
  manifest only registers the boot receiver), so `app.json` declares it under
  `android.permissions`. The app does nothing at boot; the permission exists to
  satisfy the job scheduler.
- **Android 13+ hides the service notification without `POST_NOTIFICATIONS`.**
  The service is a real foreground service (`isForeground=true`, type
  `location`, notification attached) and the status bar shows the location
  indicator, but the shade reads "No notifications": on API 33+ a
  foreground-service notification is suppressed until the runtime notifications
  permission is granted, and this app does not request it. The plan's assumption
  that FGS notifications are exempt was wrong on this API level. Left as is for
  this stage — surfacing the notification means one more permission prompt,
  which is a product decision, not a stage-2 mechanic. When taken, it needs
  `POST_NOTIFICATIONS` in `android.permissions` plus a runtime request (React
  Native's `PermissionsAndroid` suffices; no `expo-notifications`).
- **The stage-1 whole-run display hold is reverted.** `runHoldsScreenAwake`
  returns `locked` on both platforms again; decision item 5 is now the rule on
  Android too, because the timer and the fixes survive a sleeping screen.
- **Denied degrades as on iOS, verified:** with "Don't allow", the run starts, the
  banner names both losses, no distance row appears, no service is started, and
  the timer read 1:20 after 81 s of wall time across a 45 s dark window.
- **Vibration cues stay foreground-gated** (`cue-service/adapter.android.ts`,
  stage 1's "a vibration the runner cannot place" rule). The heartbeat now makes
  an off-screen vibration *possible*; whether it is wanted is for stage 3 to
  decide together with speech.
- **Observed once, not reproduced:** on the very first launch after a native
  install, the primer's `requestForegroundPermissionsAsync()` promise did not
  settle after the grant (the OS recorded it; a second tap resolved instantly).
  Two later attempts through the primer and one through Settings all resolved
  normally. Noted here so a recurrence is recognised as a cold-start race in
  expo-modules-core's permission requester rather than an app bug.
