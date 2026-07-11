# 7. Run engine: a wall-clock, event-log state machine

Date: 2026-07-11

## Status

Accepted

## Context

The run engine (C25K design spec §5) times walk/run segments for up to ~40
minutes across foreground, locked-phone background, process death, and
resume — and every cue, segment transition, and saved result derives from its
notion of elapsed time. The environment is hostile to naive timing:

- **JS timers cannot be trusted for elapsed time.** iOS pauses/throttles RN
  timers in background; `RCTTiming` has a known failure class where timers
  never fire when iOS launches the app directly into the background
  ([react-native#38711](https://github.com/facebook/react-native/issues/38711))
  — precisely the headless scenario background location can create. Timers
  are only good for waking the UI, never for measuring time.
- **Monotonic clocks are a trap here.** RN 0.86's `performance.now()`
  resolves to `NativePerformance.now ?? global.nativePerformanceNow ??
  Date.now` (verified in the installed source). The native sources are
  monotonic, but (a) a monotonic origin resets across process death, which
  breaks crash resume, and (b) on Apple platforms the underlying monotonic
  clock (mach absolute time) **does not advance while the device sleeps** —
  so it undercounts exactly during this app's flagship scenario, a
  locked-phone run.
- Heartbeats are irregular by design: ~1 Hz location events while locked
  (spec §6), a 1 s `setInterval` in foreground for UI smoothness, with
  arbitrary gaps possible in between.
- The engine must be unit-testable under `bun test` with no platform mocks
  (ADR 0003), and crash recovery (spec §5) requires that engine state can be
  rebuilt exactly from persisted data (ADR 0004's `active_run_snapshot`).

## Decision

The engine is a **pure TypeScript state machine whose entire state derives
from a timestamped event log**, with wall-clock time (`Date.now()`) as the
single time source.

1. **States and inputs** as spec §5: `idle → running(segmentIdx) ⇄ paused →
   completed | abandoned`; inputs `start(sessionKey)`, `pause()`, `resume()`,
   `skipSegment()`, `endEarly()`, `heartbeat(now, fix?)`.
2. **Time is derived, never accumulated.** The engine appends events
   (`start` / `pause` / `resume` / `skip`, each wall-clock-stamped) and
   computes `activeElapsed(now) = now − startedAt − Σ(pause intervals)`.
   The segment timeline is a prefix-sum over planned durations adjusted by
   skip events; the current segment is `activeElapsed`'s position in it.
   Replaying the same event log always yields the same state.
3. **Wall clock only.** Every event and every `heartbeat` uses `Date.now()`.
   Monotonic time is rejected for the two researched reasons above, and so
   is dual-clock anomaly detection: because the monotonic clock pauses
   during device sleep, wall-vs-monotonic divergence is indistinguishable
   from a normal locked-phone interval — a detector would false-positive in
   the app's core scenario. The engine instead enforces cheap invariants:
   event timestamps are clamped non-decreasing (elapsed can never go
   negative), and completion is capped at timeline exhaustion, so the worst
   a forward clock jump can do is end the session early as `completed`.
   The residual risk — a user manually changing the clock mid-run corrupts
   that run's times — is accepted: iOS defaults to automatic time, the data
   is a personal training log, and GPS distance is unaffected.
4. **Heartbeats drive derivation; cues fire on change.** Any heartbeat
   recomputes the current segment; a cue fires only when the *derived*
   segment differs from the last announced one. A late heartbeat therefore
   speaks a cue late but never skips or double-fires it. Transitions crossed
   while the process was dead are not spoken retroactively — resume plays a
   single "Resuming your workout" cue.
5. **Persistence is the log, not the derivation.** Every ~5 s the serialized
   event log (plus session key and announced-cue watermark) is upserted into
   `active_run_snapshot` in the same transaction as the GPS point batch
   (ADR 0004). Resume rebuilds the engine by replaying the log; a snapshot
   older than planned session length + 30 minutes, or failing invariant
   checks, finalizes the run as `partial` instead.
6. **Purity and ports.** The engine imports nothing from React or Expo;
   clock, cue service, persistence, and location arrive as injected ports
   (ADR 0003). UI subscribes via `subscribe`/`getSnapshot` +
   `useSyncExternalStore`. Unit tests inject a fake clock and assert
   behavior across pause/skip/resume orderings, heartbeat gaps, replay
   identity, and clock-anomaly clamps.

## Consequences

- Correctness is independent of heartbeat cadence: timers may throttle,
  location events may gap, the process may die — elapsed time stays right
  because it is recomputed from timestamps, never accumulated.
- Crash recovery is replay, not reconstruction: the snapshot *is* the event
  log, so there is no second serialization format to keep in sync with
  engine internals.
- The whole engine is testable with `bun test` and a fake clock — including
  the failure modes (clock jumps, stale snapshots) that are impractical to
  produce on a device.
- Cue latency equals heartbeat cadence (worst case ~1 s while locked).
  Acceptable for coaching cues; no additional timer infrastructure is
  bought back for it.
- The event log is tiny (a handful of entries per run) — no compaction or
  storage concerns.
- The engine's clock honesty depends on the device's: manual mid-run clock
  changes corrupt that run's elapsed time, by explicit accepted trade-off.

## Alternatives considered

- **Accumulated elapsed (`elapsed += tick`)** — rejected: assumes ticks
  arrive on schedule, which RN background behavior disproves (#38711 class);
  drifts in foreground; unrecoverable after process death.
- **Monotonic clock (`performance.now()`) as time source** — rejected:
  origin resets across process death (breaks crash resume) and mach-based
  monotonic time pauses during device sleep (undercounts locked-phone runs).
- **Dual-clock (wall + monotonic) clock-change detection** — rejected: sleep
  pausing makes divergence ambiguous in exactly the scenario that matters;
  complexity without a reliable signal.
- **XState (or another statechart library)** — rejected: this is a
  four-state machine whose real substance is the timestamped log and the
  derivation math, which a statechart library does not provide; a dependency
  is not justified where a ~200-line pure module suffices.
- **Native timer / background-task keepalive to tick the engine** —
  rejected: unnecessary (location events already wake JS while locked —
  forthcoming ADR 0008), and native additions fight CNG for no correctness
  gain, since ticks still couldn't be trusted as a time source.
- **react-native-reanimated for clock behavior** — evaluated against the
  installed 4.5.0: Reanimated 4 has no clock API (Reanimated 1's `Clock` was
  removed long ago); its time primitive is `useFrameCallback`/`FrameInfo`,
  driven by `requestAnimationFrame` loops on the UI thread (verified in
  `FrameCallbackRegistryUI.ts`). Frame callbacks fire only while frames are
  being drawn — they stop when the screen locks or the app backgrounds, and
  reset on process death — so as an engine time source it is strictly weaker
  than the wall-clock event log. Rejected for timing; it remains the right
  tool for *foreground UI smoothness* (worklet-driven animation between
  engine heartbeats) in RN-rendered elements, noting the run screen's
  countdown and gauge are SwiftUI per ADR 0005.
