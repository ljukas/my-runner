# 26. Free run: an open-ended run mode behind a `RunMode` strategy, with run/walk/stopped buckets derived from smoothed GPS speed

Date: 2026-09-29

## Status

Proposed — draft for review. Flip to `Accepted` on merge. Design and staging:
[`docs/superpowers/specs/2026-09-29-free-run-design.md`](../superpowers/specs/2026-09-29-free-run-design.md).
Decides the "open-ended run mode in the engine" that
[ADR 0018](0018-free-run-route-generation.md) §6 left to build time; ADR 0018's
route loops layer on top of it later.

## Context

The owner wants a **free run**: start a run at any time, with no scripted intervals,
and end it by hand. The app should still split it into **running, walking and
stopped** stretches, so that active time and pace come out right. A walk break must
not dilute running pace, and standing at a crossing must not count as moving. The
owner made each product decision explicitly (2026-09-29); they are listed in the spec
§2 and are not re-argued here.

What constrains the design:

- **The engine assumes a finite, scripted timeline.**
  - `RunEngine` derives everything from an event log plus a timeline of
    `PlanSession.segments` ([ADR 0007](0007-run-engine-event-log.md)).
  - `refresh()` caps elapsed time at the timeline total. `heartbeat()` finalizes the
    run as `completed` when `positionAt` reports `done`. `finalize()` caps active time
    at the total and builds the saved segments from the timeline.
  - An empty segment list is `done` immediately (`src/domain/segments.ts`).
  - The cues (transition, halfway, last run), the crash-resume freshness window
    (planned length + 30 min) and `isTimelineExhausted` are all measured against the
    plan.
- **The only live signal is GPS.** Neither platform has a live step or cadence
  stream. `StepCounterSource` is read once, at finalize, and only alongside a
  barometer capture ([ADR 0015](0015-run-elevation-on-device-barometer.md)). The
  Kalman smoother already computes a smoothed speed on every fix
  (`src/domain/geo.ts`, `smoothFix`) and discards it.
- **Live distance must equal the finalize re-derivation**
  ([ADR 0021](0021-on-device-gps-track-smoothing.md) §3). `finalizeRun` re-runs the
  smoother over `run_points` and credits each committed distance delta to the segment
  of the fix that ends it (§4). The per-segment distances must add up to the run
  distance.
- **Classifying *standing* failed three times before.** The
  [pace-chart stationary-time design](../superpowers/specs/2026-08-05-pace-chart-stationary-time-design.md)
  tried to detect standing from committed distance (a speed window, then a hold
  duration, then a release rate). All three failed on slow walkers, because the
  deadband throws away the information that tells the two apart. This decision uses
  a different signal (the smoother's velocity, not committed distance). It is
  measured below on real captures, and the slow-walker limit is stated rather than
  assumed away.
- **A precedent exists for a run outside the plan.** The field-test capture
  (`src/services/field-test.ts`) is identified by a reserved session key that no plan
  day claims. That key alone keeps it out of plan completion
  ([ADR 0023](0023-session-completion-projection-manual-marks.md)), gives it its own
  crash-resume rule and its own Log title, and lets it skip Health.
- **HealthKit segments are not writable through the current library.** In
  `@kingstinct/react-native-healthkit` 14.0.2, `saveWorkoutSample(type, quantities,
  start, end, totals?, metadata?)` takes no events or activities. Its Swift passes
  `workoutEvents: nil`, and it exposes no `HKWorkoutBuilder`.
- **Health Connect segments are writable.** `react-native-health-connect` accepts
  `ExerciseSessionRecord.segments` with `ExerciseSegmentType.RUNNING` (46) and
  `WALKING` (64), verified in `node_modules/react-native-health-connect/src/constants.ts`.

**Measured before deciding (2026-09-29).** The spec §4 has the method and the full
table.
- Replaying `smoothFix` over 12 on-device captures (8 plan runs, w2–w4, plus 4
  near-stationary field tests) gives the following Kalman speeds:
  - walk segments: median 1.67 m/s, p90 1.96;
  - run segments: median 2.54 m/s, p10 2.09;
  - standing: median 0.24 m/s, p95 0.69.
- A hysteresis classifier with an 8 s dwell and backdated boundaries was run on the
  plan runs, with the plan's own run/walk labels as ground truth:
  - It agrees with those labels on 93.4% of fixes. The ground truth itself lags,
    because runners don't switch at the exact cue.
  - It labels 99.2% of field-test time as stopped.
  - Its run pace lands within ±3% of the scripted run pace on 7 of the 8 runs.
  - The eighth (w2d1) differs by −8.8%, because that runner stopped during a scripted
    run segment. Detection excluded the stop, and the scripted figure did not.
  - On the same runs, today's blended Avg Pace reads 1:30–2:20 min/km slower than run
    pace.

## Decision

### 1. A run is scripted or open, and the engine delegates what differs to a `RunMode`

- A new pure type in `src/domain/free-run.ts`:
  `RunPlan = { mode: 'scripted'; session: PlanSession } | { mode: 'open'; goal: null }`.
  - `goal` is the seam for ADR 0018's target distance and route. It is always `null`
    until that feature is decided.
- The engine gets a `RunMode` strategy (`src/services/run-engine/mode.ts`), made by
  `modeFor(plan)`. It owns every plan-relative rule:
  - position and done;
  - the cue tick;
  - the resume window;
  - `exhausted`;
  - how a run's segments are produced at finalize;
  - the status a finished run is saved with.
- `ScriptedMode` wraps today's logic **verbatim**, so plan runs keep their behaviour
  and their tests. `OpenMode` is never done by itself, saves `completed` whether it is
  ended or abandoned (a free run has no plan to fall short of), and allows resume up
  to 4 h after the last flush.
- Everything plan-independent stays in the engine unchanged: the event log, active
  time, GPS ingest, flushing, sensors, pause and resume.

### 2. Identity is a reserved session key; there is no schema migration for identity

- A free run is stored with `runs.session_key = 'free-run'`, following the field-test
  precedent. `planOf(sessionKey)` maps the stored key back to a `RunPlan` on resume.
  The key can never equal a plan key (`wNdN`), so ADR 0023's completion projection
  never counts it; a unit test guards that.
- One `runTitle(sessionKey)` helper replaces the field-test ternaries in both Log
  files, the summary header and the resume sheet.
- A `runs.mode` column was rejected: it would need a migration to carry one boolean
  the key already carries.

### 3. Buckets are a pure streaming classifier over the smoother's speed, re-derived at finalize

- `SmoothStep` gains `smoothedSpeedMps`: the Kalman speed, null on restarted or
  rejected steps. The change is additive; existing callers ignore it.
- `src/domain/run-motion.ts` exports:
  - `motionStep(state, sample)`, a causal reducer over kind `run | walk | stopped`;
  - `rollupOpenTrack(fixes, activeSecondsOf)`, the batch fold.
- The reducer's rules:
  - hysteresis on the speed;
  - a candidate kind must hold for a minimum **dwell** before it is confirmed;
  - a confirmed boundary is **backdated** to the fix where the candidate began;
  - a GPS restart holds the current kind;
  - a pause clears any pending candidate.
- Starting constants, measured in §Context: run at 2.1 m/s and above; leave run below
  1.9; stopped below 0.7; leave stopped above 1.0; dwell 8 s. They are named in one
  block and tuned in stage 1 against the captures before anything ships.
- **Live** (`ingestFix`, and `rebuild()` on crash-resume): the same reducer runs over
  the same fix stream. It feeds only the run screen's current-bucket label and its
  rolling pace, and neither is persisted. Open-run points are stored with
  `segmentSeq = 0`.
- **Finalize** re-runs `rollupOpenTrack` over `run_points`. That produces the
  authoritative buckets with backdated boundaries, which live tagging could never
  have.
- Distance attribution extends ADR 0021 §4 from segment sequence to time: each
  committed delta goes to the bucket containing its end fix. So the buckets add up to
  the run distance exactly, and the `finalizeRun` check still holds. Distance itself
  is unchanged: one smoother fold, so live distance equals the re-derived distance.
- Because buckets are re-derivable from stored points, retuned constants can later
  re-bucket old runs.

### 4. Buckets are stored as ordinary `run_segments` rows

- `CompletedRunRecord` gains `segmentation: 'scripted' | 'derived'`, so the DB layer
  never parses a session key. For a `'derived'` run, `finalizeRun` writes one row per
  bucket: `kind` is run, walk or stopped; `planned_duration_s` is 0; `actual_duration_s`
  is active seconds with pauses excluded via the event log; `distance_m` comes from
  the fold.
- The `run_segments.kind` enum widens with `'stopped'`. It is a TypeScript-only enum
  on a `text` column, so `bun run db:generate` is expected to emit nothing; any
  output it does emit is committed.
- The plan-facing `SegmentKind` does **not** widen. `StoredSegmentKind = SegmentKind |
  'stopped'` is used only by summary and route code.
- A run with no location has no points, so it saves no buckets and shows a time-only
  summary.

### 5. Free-run pace: run, walk and moving; plan runs unchanged

- A pure `bucketStats(segments)` computes:
  - run pace: Σ run distance ÷ Σ run time;
  - walk pace: Σ walk distance ÷ Σ walk time;
  - moving pace: (run + walk distance) ÷ (run + walk time), so stopped time never
    counts against it.
- These are sums of distance over sums of time, never an average of per-bucket paces.
- The free-run summary shows these three in place of Avg Pace.
- The pace chart shades its x-axis by bucket, using bands derived from the stored
  rows (only in `run-profile-chart.tsx`, [ADR 0024](0024-victory-native-charting.md)).
- The route and `SegmentBreakdown` gain a stopped colour.
- Plan-run summaries do not change.

### 6. Surfaces

- **Entry: a header button on the Plan tab.**
  - iOS: a `Stack.Toolbar` button.
  - Android: an RN `Pressable` with a `SymbolView` using an `{ ios, android }` symbol
    pair, because SF-Symbol toolbar buttons render nothing there.
  - It opens a new root-Stack sheet, `free-run` ([ADR 0006](0006-modal-surfaces-as-router-screens.md)),
    shaped like `session/[key]`.
- **Run screen.** `RunSnapshot` becomes a union on `mode`, so a count-up screen
  cannot read countdown fields. `run.tsx` narrows on it and renders a new
  `FreeRunReadout`: count-up clock, current bucket, distance, and pace over the last
  ~45 s.
- `RunTransport` (both forks) hides Skip for open runs.
- **No location.** Allowed as a timer-only run, with the existing unavailable
  banner.

### 7. A kilometre cue, for free runs only

- A new milestone cue, `kilometre`, whose phrase is built from the distance and the
  last kilometre's moving pace.
- `CueService.announce` gains an optional parameter for that phrase.
- `CUE_CATEGORY`, `CUE_PHRASE` and `CUE_HAPTIC` are `Record<CueId, …>` maps, so the
  compiler enforces every entry.
- `OpenMode` fires the cue when `floor(distance / 1 km)` rises. After a resume the
  kilometre count is re-derived from distance, so a kilometre crossed while the
  process was dead is skipped rather than announced late.
- Paused and resumed cues are unchanged. Scripted runs never fire `kilometre`.

### 8. Health workouts carry run and walk segments, for every run

- `HealthWorkoutInput` gains `segments` with kind running or walking, each with
  wall-clock windows. A pure `segmentWindows` maps active-time offsets to wall clock
  through the event log.
- The mapping by run type:
  - Plan runs: warm-up, walk and cool-down map to walking; skipped segments are
    dropped.
  - Free runs: stopped is omitted.
- **Android** writes them as Health Connect exercise segments.
- **iOS** needs an owned local Swift module (`modules/workout-writer/`) that writes
  the workout through `HKWorkoutBuilder`. The library's route builder needs the
  library's own workout proxy, so the route moves into that module too.
  - This follows the "own a tightly scoped connector" precedent in ADR 0011.
  - It moves the iOS fingerprint (the release goes through build, not OTA; ADR 0012).
  - It starts with a device spike and is the last stage; ADR 0011 is amended when it
    ships.
  - Until then, iOS keeps writing today's single workout.

## Consequences

- Plan runs get a real seam instead of a scattering of `openEnded` checks. The price
  is one refactor of a ~960-line engine that plan runs depend on. Stage 2 therefore
  ships the refactor with **no behaviour change**, proven by the existing
  `engine.test.ts` suite passing unmodified, before any open-mode behaviour is added.
- Buckets appear only on the saved run. The live label lags by the dwell (≈8 s) and
  can briefly disagree with the final result near a boundary; that is cosmetic, and
  the saved buckets are authoritative.
- **Slow movement below ~0.7 m/s (about 24 min/km) is labelled stopped.** The field
  test's standing noise reaches 0.69 m/s at p95, so no threshold separates a very
  slow shuffle from standing. The consequence is limited to moving time and pace; the
  distance still counts. This is the stated limit, not a claim that standing is
  classified perfectly (see §Context on the three earlier failures).
- The classifier was measured on one runner, one phone, one city, weeks 2–4. The
  threshold sits in the overlap of this runner's slow runs and fast walks (walk p95
  2.10 m/s, run p10 2.09). Another runner's walk or jog may sit elsewhere; the owner
  chose a fixed threshold with no setting knowing this.
- Several `run_segments` rows per free run, one per bucket. At a few hundred at most
  this is fine for SQLite and for `distanceBySegmentSeq`.
- No migration. The key and the widened TypeScript enum carry everything.
- Stages 1–4 do not move the native fingerprint. Stage 5 (the iOS Health module)
  moves it deliberately.
- ADR 0018's target distance and route attach as `OpenMode.goal` without engine
  surgery.

## Alternatives considered

- **Live tagging (`run_points.segment_seq` = bucket index as fixes arrive).** The
  smallest change, and finalize stays as it is. Rejected: every boundary lands one
  dwell late, forever, and retuned thresholds could never re-bucket old runs.
- **`openEnded` flags in the engine instead of a `RunMode`.** Cheaper, with a smaller
  diff. Rejected by the owner in favour of the strategy: flags spread plan-relative
  rules across ~6 sites, and the ADR 0018 goal would add more.
- **One giant synthetic segment, as the field test uses.** Rejected: its cap silently
  ends a long run, every point shares one bucket, and the countdown fields stay wrong.
- **A per-point `kind` column.** Rejected: it needs a migration and stores what
  finalize can derive. Live tags would be the wrong ones anyway.
- **Cadence as a second signal.** Deferred. It needs new live step streams on both
  platforms and a device to test, and the emulator has no step counter. The reducer's
  input is where it would enter.
- **Auto-pause.** Out of scope by the master spec (§14). Stopped time counts as
  active but is excluded from pace, which gives the pace benefit without a
  disappearing clock.
