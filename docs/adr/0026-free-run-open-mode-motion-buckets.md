# 26. Free run: an open-ended run mode behind a `RunMode` strategy, with run/walk/stopped buckets derived from smoothed GPS speed

Date: 2026-09-29

## Status

Accepted (2026-09-29, on merge of #77). Stage 1 (the classifier) is in implementation. Revision 2: revision 1 went
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
  - **97.3%** mean agreement on the plans' walk/run intervals. Each run is held out from
    the threshold it is scored with, and the first 10 s of each interval are excluded.
  - The worst run scores 92.0%; the tired day scores 94.8%, where a midpoint-of-medians threshold scored 70.1%.
  - Run pace is within 2% on 7 of the 8 runs. The eighth runner stopped inside a
    scripted run segment; detection excludes that stop, and the script's own pace
    includes it.
  - It labels **99.6%** of field-test active time as stopped.
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
  reducer; `openTrackStep`, one fix through the smoother and the reducer, which the live
  engine calls; and `rollupOpenTrack`, which folds that same step. The step takes the run's
  paused intervals and its threshold, so the live fold and the batch fold see the same
  boundaries.
- **The rules:**
  - **Start state.** No kind until the first non-null speed.
  - **Direct transitions.** Any kind can move to any other: run, walk or stopped.
  - **Stopped hysteresis.** A speed below 0.5 m/s means stopped. Leaving stopped needs a
    speed above 0.8 m/s.
  - **Run/walk split.** A single threshold `T` divides run from walk. It has no band:
    the data showed a band adds nothing once the dwell has a majority rule.
  - **Dwell with a majority rule.** A candidate is confirmed after **8 s** in which at
    least **70%** of its samples differ from the current kind, on a sample that still
    differs. A change that has already reverted by then is not confirmed.
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

## Amendment (2026-09-29): stage 3a built

The engine and persistence half shipped as stage 3a; the surfaces are stage 3b. Where the build
refined this ADR:

- **§4's record flag** is `CompletedRunRecord.derived: { thresholdMps }` rather than a
  `segmentation` field: its presence means derived, and plan records stay identical.
- **§3/§6's end is settled in one place,** `deriveOpenRun` (`src/domain/open-run.ts`), called by the
  derived finalize for every origin — runner, limit and abandon alike, since an abandoned run has no
  points in memory. It applies the 4 h cap, trims a trailing stop of 30 min or more, cuts the event
  log with it, and discards what is left under a minute. `OpenMode` also treats an ending under a
  minute as a discard, rounding as the saved duration does; and because the trim can still leave a
  run under a minute, the engine speaks a free run's `complete` only once its save kept it.
- **§6's 30-minute limit counts only a measured stop** (owner decision, 2026-09-30). A GPS silence
  is stopped time in the buckets — a gap between fixes and a trailing silence alike (`silentSince`)
  — but only the part of a stop the fixes measured (`OpenTrackState.measuredStop`: active time from
  the stop's start to its latest fix, less any silence inside it) ends a run live or trims it at
  finalize. A treadmill run or a lost signal therefore runs to End or the cap and is saved in full,
  its silence as stopped time. The measured stop is part of the step both the live engine and the
  fold take, so the live limit and the finalize trim read one value by construction.
- **§3's classifier asserts no kind without evidence** (round-3 review). The first kind needs the
  same 8 s dwell as any change, since a first sample comes off a fresh smoother; a gap forgets the
  kind rather than re-asserting the one before it, so a stop right after a silence joins it (and is
  trimmed through it) instead of leaving a phantom walk between them, while a stop that continues
  across a gap keeps its measured time; and a silence before the first fix is stopped time, like
  any other. Held-out agreement over the 8 plan-run captures is unchanged at 97.3%.
- **A timer-only free run has no buckets.** With no speed ever measured, the fold confirms no kind,
  so no `run_segments` rows are written; the duration comes from the event log and the points keep
  `segment_seq` 0.
- **§6's discard** stops the scheduler, drains the flush chain, marks the snapshot `discarding` and
  then deletes the run and its children (no FK cascade); a launch that finds the mark finishes the
  delete. While it runs, no flush may write the run back — including the one a late `startRun`
  would queue. A failed mark still deletes, and the snapshot is cleared only once the delete has
  landed. The delete never waits on the run still being current: a `reset()` or `start()` during it
  skips only the mark and the clear, whose snapshot row is then the next run's. Nothing in the app
  deleted a run before (ADR 0004's 2026-09-29 amendment).
- **Every ending survives being overtaken.** A finalize captures its run's generation and row id
  before its first await; overtaken by `reset()` or `start()`, it still saves on its own row and
  touches nothing the next run owns (its status, cues, sensors or snapshot). This holds for plan
  runs too, and so does `abandon()`, which no longer resets a run started while it finished.
- **§5's resume** treats the time the process was dead as a pause: restoring an open run appends a
  pause at its last known-alive instant and a resume at now, so a long downtime neither ends it as
  stopped time nor spends its 4-hour cap, and its exhaustion is judged at that instant too. A plan
  run resumes as before.
- **The fold's pause rule needs a floor.** It drops a fix stamped inside a pause or after the end,
  so an open run's pause, resume and end land at least 1 ms after the latest fix it was fed
  (`RunMode.eventFloorMs`), and the saved distance keeps every fix the live one counted. A fix is
  stored at `min(fix time, wall clock)` (`RunMode.fixTimeMs`), so one dated ahead cannot drag the
  floor, and the run, out to its time. The one end not floored is the cap's, which is placed at the
  4-hour instant; with fixes clamped, none the run counted lies past it.
- **One entry point,** `start(plan: RunPlan)`: the mode, not the engine, knows what a free run adds
  (its threshold, its start note, its opaque `modeState`).
- **The snapshot's 3b fields** are in the engine already: `gpsStale` (no speed for 10 s) in place of
  a has-fix flag, `endDiscards` for the End dialog, `elapsedAnchorMs` for the count-up clock, and
  `lastOutcome` (`discarded` / `tooShort`) on the idle snapshot a free run leaves without a summary.
- **A free run whose `startRun` failed** is saved through `saveRun`, which derives it from its log
  (no points could be written, so it has no buckets or route, but keeps its live distance) and
  returns null when it was too short to keep.
- **§4 as built.** The `segment_seq` rewrite is by timestamp with the fold's `(start, end]` rule,
  not by fix `seq`, and a trimmed or capped end also deletes the points and barometer samples past
  it — both exceptions to their rows being append-only. A derived finalize folds with the pause rule
  itself and never calls `smoothTrackBySegment` or its `__DEV__` sum check, which have no pause rule
  and would disagree with a free run's saved distance.
- **The kind enum** gained `'stopped'` with a label, colour (`systemBrown`) and symbol
  (`figure.stand` / `accessibility_new`) wherever a stored kind is looked up — moved from 3b into 3a,
  because the widened type would not compile without them. Nothing can create a stopped row until
  3b adds the entry point.

## Amendment (2026-09-30): stage 3b built

The surfaces shipped as stage 3b ([plan](../superpowers/plans/2026-09-30-free-run-stage-3b-surfaces.md)).
Where the build refined this ADR or the spec:

- **The entry** is a "New free run" button on the Plan header: an iOS `Stack.Toolbar` button, and on
  Android a header view in a fork of the Plan stack's layout. It is disabled while the launch-time
  resume is looked for or decided; the resume gate became an observable store for it. It starts
  closed, and a check that fails opens it, since there is then nothing to offer. Only this entry
  waits on the gate: a plan session's Start can still land during the check — milliseconds when it
  finds an offer, seconds while it abandons a stale run, where run generations keep the two apart.
  The `/free-run` sheet shares the session sheet's start action (`useStartRun`).
- **The run screen's phase** reads Running, Walking or Stopped in the bucket's colour, and "Waiting
  for GPS" or "Timer only" in a neutral grey with their own symbols, so a run without GPS never
  reads as stopped. The rolling pace shows only for a confirmed run or walk.
- **End** uses one `end` variant on `RunTransport` (a plan run's dialog is word for word as before;
  a free run's offers Save Run and Discard, with Discard in the Android dialog's body). Under a
  minute, End asks nothing and takes the save path, which the mode turns into a "too short"
  discard, so only the dialog's Discard reads as "discarded" (ADR 0006's 2026-09-30 amendment).
- **The not-saved notice** is a store whose few seconds count from when the Plan tab is focused
  with it (it is posted while the run modal still covers Plan), fed once per outcome by a module-scope bridge from
  the engine's idle snapshot (deduped by snapshot identity, so a remount never repeats it) and by a
  declined resume whose free run was deleted; the Plan list shows it as its first row. A run that
  leaves no summary — from the run screen or the resume sheet — dismisses back to the tabs
  (`leaveToTabs`), where a `<Redirect>` or `replace('/')` had pushed a second copy of them.
- **The resume sheet on Android** cannot refuse a dismissal: `gestureEnabled` is iOS-only, and the
  legacy formSheet ignores `preventNativeDismiss`, so back, a scrim tap or a drag closes it. Such a
  dismissal saves the run, as an offer that expires does. Leaving it undecided would keep the run
  hidden and the gate shut, and a new run would then orphan its row for good.
- **The summary** without measured distance keeps only Active Time, so the E2E flows anchor on it
  (spec §8 corrected).

## Amendment (2026-09-30): stage 5a built

Health Connect segments shipped as stage 5a ([plan](../superpowers/plans/2026-09-30-free-run-stage-5a-health-segments.md)).
Where the build changed §8 and the Consequences:

- **Pauses are written, as PAUSE segments** (owner decision). §8 said nothing is written for a
  paused span. Health Connect subtracts PAUSE and REST segments from a session's exercise
  duration, so an unwritten pause counted as exercise time. A pause the event log ended in runs to
  the workout's end. Stopped time stays REST, so Health Connect's duration for a free run is its
  moving time, not the app's active time.
- **Pauses stay out of the segment list in the domain.** `HealthWorkoutInput` carries `segments`
  and `pauses` apart, because HealthKit models a pause as a pause/resume event, not a segment
  (stage 5b); the Health Connect mapper merges them.
- **Fingerprints (correcting the Consequences):** the patch moves **both**. `@expo/fingerprint`
  hashes `patches/` for iOS and Android alike; Android also hashes the patched package. iOS went
  `fd770db…` → `9d09364…` with `patches` as its only new source. Ignoring the directory was offered
  and declined, so the next iOS release is a store build.
- **Verified on the emulator:** plan and free runs read back with their walking, running, rest and
  pause segments intact, and Health Connect's own entry details list them (§6 of the spec had that
  unconfirmed). That Health Connect's aggregate duration subtracts them is not verified: aggregates
  need a READ permission the app does not hold.
