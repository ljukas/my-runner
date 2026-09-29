# 26. Free run: an open-ended run mode behind a `RunMode` strategy, with run/walk/stopped buckets derived from smoothed GPS speed

Date: 2026-09-29

## Status

Proposed — draft for review. Flip to `Accepted` on merge. Revision 2: revision 1 went
through four adversarial reviews on 2026-09-29 (evidence, engine, Health, and the spec's
premises). This revision applies their findings and the owner's answers to what the
findings reopened. The spec's §10 records both.

Design and staging:
[`docs/superpowers/specs/2026-09-29-free-run-design.md`](../superpowers/specs/2026-09-29-free-run-design.md).
This ADR decides the "open-ended run mode in the engine" that
[ADR 0018](0018-free-run-route-generation.md) §6 left to build time. ADR 0018's route
loops layer on top of it later.

## Context

The owner wants a **free run**. It can start at any time, has no scripted intervals, and
is ended by hand. It is split into **running, walking and stopped** stretches, so that a
walk break does not dilute running pace and standing at a crossing does not count as
moving. The owner's decisions are listed in spec §2.

What constrains the design:

- **The engine assumes a finite, scripted timeline**
  ([ADR 0007](0007-run-engine-event-log.md)).
  - Elapsed time, completion, the saved active duration, the saved segments, three cues,
    crash-resume freshness and `isTimelineExhausted` are all measured against
    `PlanSession.segments`.
  - Beyond those rules, several pieces of state and several readers assume a plan:
    - state: the `lastRunIndex`, `plannedTotalS`, `lastAnnouncedIndex` and
      `halfwayFired` fields;
    - the persisted snapshot parser;
    - the segment index stamped on altitude samples;
    - the countdown clock hook, and the End dialog's copy.
  - An empty timeline is `done` at once, and its total of 0 would save a run of 0 s.
  - Spec §3 lists every such site with its line number.
- **The only live signal is GPS.** Neither platform streams steps or cadence. The Kalman
  smoother computes a velocity on every fix (`smoothFix` in `src/domain/geo.ts`). It
  updates that velocity *before* the near-stationary deadband, so the velocity survives
  the loss of detail that sank earlier attempts (next bullet).
- **Standing was misclassified three times before.** The
  [pace-chart stationary-time design](../superpowers/specs/2026-08-05-pace-chart-stationary-time-design.md)
  classified standing from *committed distance*. The deadband throws that distance
  away, and all three designs failed on slow walkers.
- **Live distance must equal the finalize re-derivation**
  ([ADR 0021](0021-on-device-gps-track-smoothing.md) §3/§4).
  - Each committed delta belongs to the segment tagged on the point that ends it.
  - The route, the splits, the barometer rows and the export are all joined through
    that same tag, `segment_seq`.
- **A precedent for runs outside the plan.** The field test (`src/services/field-test.ts`)
  uses a reserved session key that no plan day claims. That keeps it out of plan
  completion ([ADR 0023](0023-session-completion-projection-manual-marks.md)) and gives
  it its own resume rule (`offerable: false`) and its own title.
- **Health segments are harder than they look.**
  - Health Connect accepts walking and running segments inside a running session:
    running (56) allows segment types `RUNNING` (46), `WALKING` (64) and the universal
    `REST` (44).
    - This was verified in the `connect-client` 1.1.0 bytecode, alongside
      `react-native-health-connect` 4.1.3's `constants.ts`.
    - However, that library's Kotlin **never reads `segments`**. It builds both laps and
      segments from a `samples` key (`ReactExerciseSessionRecord.kt:48,55`), so a
      `segments` field would be dropped without an error.
  - On iOS, `@kingstinct/react-native-healthkit` 14.0.2 cannot write events or
    activities.
    - Its `saveWorkoutSample` has no parameter for them, and the Swift passes
      `workoutEvents: nil`.
    - Apple's own APIs cannot label walking inside a running workout either:
      - `HKWorkoutActivity`s must share the containing workout's activity type.
      - `.segment` events have no kind.
      - No Apple statement says Health or Fitness displays either one for a third-party
        iPhone workout.
    - `HKWorkoutBuilder.finishWorkout` also returns no workout while the phone is locked,
      which is exactly when plan runs finish. The route cannot attach without it.

**Measured before deciding, 2026-09-29; method and full tables in spec §4.**
- **Data.** The app's own `smoothFix` was replayed over 12 on-device captures: 8 plan runs
  (weeks 2–4) and 4 indoor field tests.
- **Speeds on the plan runs.**
  - Walk intervals: median 1.74 m/s, p95 2.19.
  - Runs: median 2.54 m/s, p10 2.09.
  - The two overlap, and the overlap varies by day. On one tired day the median run was
    2.23 m/s.
- **Fixed-threshold classifier (revision 1).**
  - 93.4% agreement with the plan's labels, but only 91.4% on the walk/run intervals
    alone.
  - It could not go straight from running to stopped, so it labelled a 10–15 s stop at a
    crossing as walking.
  - It never confirmed 5 of 34 run segments for a jogger hovering at 2.10 m/s.
- **Revision 2 classifier** (described in §3 below):
  - **97.5%** mean agreement on the plans' walk/run intervals. Each run is held out from
    the threshold it is scored with, and the first 10 s of each interval are excluded.
  - The worst run scores 92.1%; the tired day scores 96.2%, where a midpoint-of-medians threshold scored 70.1%.
  - Run pace is within 2% on 7 of the 8 runs. The eighth runner stopped inside a
    scripted run segment; detection excludes that stop, and the script's own pace
    includes it.
  - It labels **98.7%** of field-test fixes as stopped.
  - It labels **every second** of synthetic 10–30 s stops inside a run as stopped.
  - For a walker at 0.8 m/s coming out of a stop, 7% of their walking is labelled
    stopped; at 1.0 m/s, none of it.

## Decision

### 1. A run is scripted or open, and a `RunMode` owns every plan-relative rule

- **`RunPlan`.** A pure type in `src/domain/free-run.ts`:
  `RunPlan = { mode: 'scripted'; session: PlanSession } | { mode: 'open'; key: 'free-run' }`.
  - ADR 0018 adds a `goal` to the open variant when it is built. Nothing reserves a field
    for it now.
- **`RunMode`.** The engine delegates to a `RunMode` made by `modeFor(plan)`, in
  `src/services/run-engine/mode.ts`. The mode owns every site in spec §3:
  - position and completion;
  - the elapsed cap and the saved-duration cap;
  - cue state and the cue tick;
  - the segment tag for new points and altitude samples;
  - whether skipping is allowed;
  - exhaustion and the resume window;
  - resume offerability;
  - finalize segments and status.
- **`ScriptedMode`.** It holds today's code for each of those sites, verbatim.
- **`OpenMode`:**
  - is never done by itself;
  - does not cap elapsed time by a timeline;
  - treats skip as a no-op;
  - offers resume up to 4 h after the last flush;
  - saves `completed`.
- **What stays in the engine:** the event log, active time, pause and resume, GPS ingest,
  flushing, sensors and persistence.
- **Resume.** `planOf(sessionKey)` returns `{ plan, offerable }`. This keeps the field
  test's `offerable: false`. `ResumableRun` and `RunRestoreInput` carry a `RunPlan`.
- **How a run ends is separate from how it is saved.** `finalize` takes an origin:
  `runner`, `limit` (from §6) or `abandon`.
  - The mode decides the saved status.
  - The `complete` cue is spoken only for `runner` and `limit`.
  - An abandoned run is finalized silently. It must never say "Workout complete" when
    the app launches.

### 2. Identity is a reserved session key; no migration

- **The key.** A free run is stored with `runs.session_key = 'free-run'`, following the
  field-test precedent.
  - The key constants live in `src/domain/`. Domain code never imports `services/`.
  - The key never matches a plan key of the form `wNdN`, so ADR 0023 never counts a free
    run as a plan day. A unit test guards this.
- **One title helper.** `runTitle(sessionKey)` replaces the per-screen ternaries in both
  Log files, in the summary, and on the resume sheet.
- **Rejected: a `runs.mode` column.** It would need a migration to store a boolean the key
  already carries.

### 3. Buckets come from a pure streaming classifier over the smoother's speed

- **Speed input.** `SmoothStep` gains `smoothedSpeedMps`, which is the Kalman speed.
  - It is null on restarted or velocity-gate-rejected steps.
  - The change is additive.
- **Where the code lives.** `src/domain/run-motion.ts` holds `motionStep`, a causal
  reducer, and `rollupOpenTrack`, its batch fold. Both take the run's paused intervals
  and its threshold, so the live fold and the batch fold see the same boundaries.
- **The rules:**
  - **Start state.** No kind until the first non-null speed.
  - **Direct transitions.** Any kind can move to any other: run, walk or stopped.
  - **Stopped hysteresis.** A speed below 0.5 m/s means stopped. Leaving stopped needs a
    speed above 0.8 m/s.
  - **Run/walk split.** A single threshold `T` divides run from walk. It has no band:
    the data showed a band adds nothing once the dwell has a majority rule.
  - **Dwell with a majority rule.** A candidate is confirmed after **8 s** in which at
    least **70%** of its samples agree.
  - **Retargeting.** A candidate can change its target kind without resetting its start
    (for example run → walk → stopped).
  - **Backdating.** A confirmed boundary moves back to the candidate's first sample.
  - **Nulls.** A null speed holds the current kind.
  - **Pauses.** A fix that falls after a pause boundary clears the candidate.
  - **After a resume.** In open mode the smoother restarts on resume, both live and in
    the batch fold. Distance travelled while paused is not counted, which matches active
    time excluding the pause. Plan runs keep today's behaviour.
- **`T` is learned from the runner, not fixed** (owner, 2026-09-29).
  - When a free run starts, `T` = the mean of the walk p90 and the run p10, taken over
    the runner's last 3 completed plan runs.
    - Only walk and run intervals count, never warm-ups or cool-downs.
    - The first 10 s of each interval are dropped.
  - Before the runner has any plan runs, `T` = 2.1 m/s.
  - `T` is recorded on the run as a `run_log` note. Finalize, and any later re-derivation,
    uses that run's own `T`, never whatever the history says by then.
  - Tested on held-out runs, this formula beat the midpoint of medians (94.3%) and the
    runner's walk p90 (93.8%).
- **Live use.** The same reducer runs live in `ingestFix` and `rebuild()`. Live, it feeds
  only the run screen's label and its rolling pace.
- **Finalize.** Finalize re-runs `rollupOpenTrack` over `run_points`, which gives the
  authoritative buckets.
  - The buckets tile the run from the `start` event to the `end` event.
  - A GPS gap longer than `MAX_GAP_S` becomes stopped time. It carries no distance and no
    moving time.
  - Each bucket's active seconds exclude pauses. The integer durations are rounded with
    largest remainder, so they sum exactly to `activeDurationS`.

### 4. Buckets are stored as `run_segments` rows, and each point's tag is rewritten at finalize

- **Bucket rows.** For a free run, `finalizeRun` writes one `run_segments` row per bucket:
  - `kind`: `run`, `walk` or `stopped`;
  - `planned_duration_s`: 0;
  - `actual_duration_s`: as described in §3.
- **Tags are rewritten in the same transaction.** Each open-run point's
  `run_points.segment_seq` is rewritten to its bucket's `seq`, using range `UPDATE`s by
  fix `seq`. `run_altitude_samples.segment_seq` is rewritten the same way, by timestamp.
  - This is a **deliberate exception** to `run_points` being append-only, and it amends
    ADR 0021 §4 when stage 3 ships.
  - The fix itself stays immutable. The tag was always a join key derived from the
    fix's position, and now finalize derives it instead of the live timeline.
  - The payoff: `smoothTrackBySegment`, per-segment distance, the `__DEV__` sum check,
    route chunking and colouring, and the export all work unchanged.
  - A retuned re-derivation must rewrite the tags as well.
- **Record shape.**
  - `CompletedRunRecord` gains `segmentation: 'scripted' | 'derived'`, so the DB layer
    never parses a key.
  - `eventLogJson` is required when `segmentation` is `'derived'`.
- **The kind enum widens.** `run_segments.kind` gains `'stopped'`.
  - Existing migrations declare `kind text NOT NULL` with no `CHECK` constraint, so no
    migration is needed.
  - The plan-facing `SegmentKind` does not widen. `StoredSegmentKind` covers the stored
    rows.
  - Every `Record<SegmentKind, …>` keyed by a stored row has to handle `stopped`: the
    labels, the colour and symbol maps (including Android's palette), route rendering,
    breakdown, legend and run stats. Spec §5.3 lists them.

### 5. Free-run pace: run, walk and moving; plan runs unchanged

- **Formulas.** `bucketStats` is pure and computes each pace as a distance sum over a time
  sum:
  - run pace = Σ run distance ÷ Σ run time;
  - walk pace = Σ walk distance ÷ Σ walk time;
  - moving pace = (run + walk distance) ÷ (run + walk time).
- **Stopped distance.** The few metres committed during stopped time are left out of all
  three paces. So the run's total distance divided by moving time does not equal moving
  pace, and the summary labels which is which.
- **Summary layout.** The free-run summary shows the three paces instead of Avg Pace. It
  also shows a bucket timeline in place of per-bucket split rows, because a free run can
  have dozens of buckets.
- **Pace chart.** It keeps its distance axis and shades run and walk bands. Each stop is
  drawn as a minimum-width **marker** at the distance where it happened (owner decision).
  All of this is drawn in `run-profile-chart.tsx` only
  ([ADR 0024](0024-victory-native-charting.md)).
- **Plan runs.** Their summaries do not change.

### 6. Surfaces and safeguards

- **Entry point.** A header button on the Plan tab, labelled "New free run".
  - On iOS it is a `Stack.Toolbar` button.
  - On Android it is a `FreeRunHeaderButton` domain component
    ([ADR 0013](0013-component-design-conventions.md)) in a `.android` fork of the Plan
    layout. Toolbar buttons with SF Symbols render nothing on Android.
  - The button is disabled while a crash-resume check is pending or a resume offer is
    open.
  - It opens a root-Stack `free-run` sheet ([ADR 0006](0006-modal-surfaces-as-router-screens.md)),
    shaped like `session/[key]`.
- **Run screen.** `RunSnapshot` becomes a union on `mode`, over a shared base type.
  - `run.tsx` delegates to one child view per mode, so the countdown hook never runs for
    an open run. The open view gets a count-up clock hook of its own.
  - The live label reads one of: Waiting for GPS, Timer only, Running, Walking or
    Stopped.
  - Rolling pace comes from the Kalman speed over the last ~45 s of moving samples. It
    shows "—" while the runner is stopped or GPS is stale.
- **Transport.** `RunTransport` hides Skip for open runs, on both platforms.
- **Safeguards** (owner, 2026-09-29). A free run can be started in two taps, is always
  saved as `completed`, and writes to Health, and runs cannot be deleted. So:
  - End offers **Save** or **Discard**. A discarded run is never saved and never reaches
    Health.
  - A free run with less than **1 minute** of active time is discarded automatically.
  - After **30 minutes** of continuous stopped time the run ends itself (origin `limit`),
    trimmed to the end of the last moving bucket.
  - Any free run ends itself at **4 hours** of active time.
  - These limits also bound ADR 0007 §3's exposure to a forward clock jump in open mode,
    which a timeline used to bound. They amend ADR 0007 §3 and §5: a stale open snapshot
    is finalized as `completed`, not `partial`.
- **Resume sheet.** For a free run, its copy reads "Save Run", not "Save as Partial".

### 7. A kilometre cue for free runs, as typed data

- **The cue.** `kilometre` is a new milestone cue, gated by the existing milestone toggle.
- **Typed data, not text.** `CueService.announce(cue, data?)` takes typed data,
  `{ km, paceSecPerKm }`, never a phrase.
  - The phrase is built from that data in `src/domain/cues.ts`, handling the singular
    "1 kilometre".
  - This keeps ADR 0009 Decision 1 ("the port speaks IDs, not strings"). The pre-recorded
    fallback plays a fixed "Kilometre" clip without numbers, and ADR 0009 is amended to
    say so when stage 4 ships.
- **Haptics.** `CUE_HAPTIC` gets its entry, as the other `Record<CueId, …>` maps do.
- **Settings.** The Settings copy that lists the milestone cues gains the kilometre cue.
- **When it fires.** `OpenMode` fires it when `floor(distance / 1 km)` goes up. The pace
  it reports is the last kilometre's moving pace, from the live buckets.
- **After a resume.** The kilometre count is re-derived from distance. If an unflushed
  tail was lost, a kilometre can be announced twice; that is accepted.

### 8. Health workouts carry run and walk segments, on Android now and on iOS if a spike succeeds

- **The pure layer.** `HealthWorkoutInput` gains `segments`. A pure `segmentWindows`
  function maps active-time offsets to wall-clock windows through the event log.
  - **Pauses.** A segment that spans a pause is split at the pause, and nothing is written
    for the paused span. The workout's start and end stay wall-clock, so its duration does
    not change.
  - **Plan-run mapping.** Warm-up, walk and cool-down map to walking; a run maps to
    running.
  - **Skipped segments.** A skipped segment with actual time above 0 keeps its actual
    window. Only zero-length segments are dropped.
  - **Stopped time.** On Android it maps to `REST`.
  - **Validation.** Windows are clamped to the workout, never overlap, and have a strictly
    positive length. All of this is tested.
- **Android.**
  - `react-native-health-connect` is **patched** with `bun patch` to read `segments`, and
    the same change goes upstream as a PR.
  - The patch moves the **Android** fingerprint. Android is not on Play yet, so no OTA
    eligibility is lost.
  - If Health Connect rejects the record, the adapter saves it again without segments.
- **iOS.**
  - A device **spike** builds a local module (`modules/workout-writer/`) that writes the
    workout through `HKWorkoutBuilder`.
  - It ships only if it meets all of these:
    - a walk/run distinction is visible in Health or Fitness on a device;
    - the route survives a finish with the phone locked;
    - sync-identifier replacement still works, including for the route.
  - If any of those fail, iOS keeps today's single workout and this section is amended.
  - If the spike ships, it moves the iOS fingerprint (ADR 0012), and ADR 0011 is amended.
- **Unchanged.** The single whole-run distance sample stays (ADR 0011 amendment item 7).
- **No backfill.** Runs already saved never gain segments, because a run that has been
  saved is not rewritten.

## Consequences

- **Plan runs get one seam.** The price is refactoring a ~960-line engine that plan runs
  depend on.
  - Stage 2 ships the refactor alone. `start(PlanSession)` keeps its signature, and the
    snapshot type gains `mode: 'scripted'` but stays flat.
  - Its proof is that `engine.test.ts` passes with **no assertion changed**. The union and
    the open entry point arrive in stage 3.
- **The live label lags a change by the dwell** of about 8 s. The saved buckets are
  backdated, but only to where the confirmed candidate began. Spec §4 measures that
  offset and states its tail.
- **The threshold adapts to the runner.** This removes revision 1's failure for slower
  joggers.
  - A runner with no plan runs gets 2.1 m/s (7:56 min/km). A slower jog is then labelled
    walking until the app has three plan runs to learn from.
  - Every figure comes from one runner on one phone. The evidence for standing is indoor.
- **Slow movement near the stopped band is a stated limit.** Out of a stop, walking at
  0.8 m/s is labelled stopped 7% of the time. Walking at or above 1.0 m/s is not.
- **One exception to `run_points` being append-only:** the `segment_seq` tag, rewritten at
  finalize (§4).
- **Fingerprints.** Stages 1–4 move neither fingerprint. Stage 5a moves Android's, through
  the library patch. Stage 5b, if the spike succeeds, moves iOS's.
- **Amendments this decision requires,** each written when its stage ships:
  - ADR 0007 §3/§5 (stage 3);
  - ADR 0021 §4 (stage 3);
  - ADR 0009 Decision 1 (stage 4);
  - ADR 0011 (stages 5a and 5b).

## Alternatives considered

- **Live tagging: write the bucket index into `segment_seq` as fixes arrive.** Rejected.
  Every boundary would land one dwell late, and retuning could never re-bucket old runs.
- **Store bucket start and end times and join on time at render.** Rejected. Every
  consumer that joins on `segment_seq` would need a second code path; rewriting the tag
  at finalize reuses all of them.
- **`openEnded` flags instead of a `RunMode`.** Rejected by the owner in favour of the
  strategy.
- **One giant synthetic segment, as the field test uses.** Rejected. Its cap silently ends
  a long run, and every point ends up in one bucket.
- **A fixed threshold, 2.1 m/s or 1.9 m/s.** Rejected once the evidence showed it fails
  slower joggers. The owner chose a learned threshold.
- **Hysteresis on the run/walk threshold.** Dropped. A band of 0 and a band of 0.1 scored
  the same once the dwell has a majority rule.
- **A time axis for free-run charts.** Rejected by the owner in favour of stop markers.
- **The `samples`-key workaround for Health Connect.** Rejected. It also writes every
  bucket as a lap, and it breaks without any error if the library fixes its key.
- **Cadence** is deferred: there is no live step stream, and the emulator has no step
  counter. **Auto-pause** is out of scope (master spec §14).
