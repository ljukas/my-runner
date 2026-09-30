# Free run — design

Date: 2026-09-29
Status: **design, revision 2, for review**
Decision record: [ADR 0026](../../adr/0026-free-run-open-mode-motion-buckets.md). This spec covers the
how and the when: the owner's decisions, the measurements behind the classifier, where the design
touches the code, and the delivery stages. §10 records the review that produced revision 2.

## 1. What this is

A **free run** is a run started from the Plan tab's header at any time. It has no scripted intervals
and is ended by hand. While it runs, the app separates running, walking and stopped from GPS speed.
The saved run keeps those buckets, so the summary shows run pace, walk pace and moving pace instead of
one blended average.

It is **not** [ADR 0018](../../adr/0018-free-run-route-generation.md)'s route generation. That feature
(a target distance that produces a suggested loop) adds a `goal` to the open run later.

## 2. Owner decisions (2026-09-29)

Asked as structured questions, in two rounds: before the design, and after the review. They are
recorded here so implementation does not reopen them.

| Area | Decision |
| --- | --- |
| Detection | Automatic, from smoothed GPS speed. No cadence. |
| Threshold | **Learned per runner** from their last 3 completed plan runs; 2.1 m/s until they have one. No setting. *(Revised after review: a fixed 2.1 m/s failed slower joggers.)* |
| Buckets | Run, walk, stopped. Stopped counts as active time and is excluded from pace and moving time. |
| Summary | Run pace, walk pace, moving pace. Plan-run summaries are unchanged. |
| Chart | Distance axis with run/walk bands; **stops drawn as minimum-width markers**. *(Clarified after review.)* |
| Run screen | Count-up clock, current bucket, distance, rolling pace. No progress bar and no Skip. |
| Ending | Saved as `completed`, including a crashed run that is not resumed. |
| Safeguards | **Save / Discard on End; auto-discard under 1 min; auto-end after 30 min stopped; hard cap at 4 h.** *(Added after review.)* Only a stop the GPS measured counts toward the 30 min; a GPS silence is stopped time but never ends or trims a run *(owner decision, 2026-09-30)*. |
| No location | Allowed, timer-only. |
| Cues | Paused/resumed, plus a per-kilometre cue for free runs only. |
| Health | Run/walk segments for free and plan runs. **Android via a patched library; iOS only if a device spike meets its criteria.** *(Revised after review.)* |
| Crash resume | Offered, up to ~4 h after the last flush. |
| Entry | A button in the Plan tab's header. |
| Architecture | A `RunMode` strategy in the engine, not flags. |
| Delivery | This design PR first, then stages that each ship a working app. |

Out of scope: detecting buckets on plan runs, a target distance or route, cadence, auto-pause, a
threshold setting.

## 3. Where the design touches the engine

Every plan-relative site in `src/services/run-engine/` and its callers, and what each becomes. Line
numbers are from `main` at 9625d73.

| Site | Today | Becomes |
| --- | --- | --- |
| `heartbeat` (`engine.ts:357-364`) | finalizes on `positionAt(...).done` | `mode.position(elapsed)`; open is never done |
| `heartbeat` → `ingestFix(fix, pos.index)` (`:367`) | tags each point with the timeline index | `mode.segmentSeqForIngest()`; open returns 0 until finalize rewrites it (§4 of the ADR) |
| `refresh` (`:465-509`) | caps elapsed at the total; builds countdown fields | `mode.position`; the open snapshot has no countdown fields |
| `announceProgress`, halfway, last run (`:513-522`) | segment and halfway cues | `mode.cueTick(ctx)`; open fires the kilometre cue |
| `start` / `rebuild` (`:312-317`, `:643-647`) | `plannedTotalS`, `lastRunIndex`, `cuesSuppressed` | mode construction; cue state belongs to the mode |
| Persisted cue state (`snapshotState` `:834-838`, `parseSnapshotState` `resumable.ts:60-71`) | `lastAnnouncedIndex` and `halfwayFired` are required, or the snapshot is rejected and its `'active'` row is orphaned | `modeState` is optional; an open snapshot writes the scripted fields as neutral values so an older parser still accepts it |
| `captureReading` (`:544`) | altitude samples stamped with `snapshot.segmentIndex` | `mode.segmentSeqForIngest()`, rewritten at finalize |
| `skipSegment` (`:346`) | no guard | `mode.canSkip()`; a no-op when open |
| `endCountsAsCompleted` (`:154`, `run.tsx:71`) | reads countdown fields | scripted view only |
| `finalize` (`:674-713`) | caps elapsed at the total; `promoteInCooldown`; segments from the timeline; `complete` cue whenever completed | `mode.finalElapsed`, `mode.finalStatus(requested, finalElapsed, origin)`, `mode.finalSegments`; `complete` spoken only for origin `runner` / `limit` |
| `abandon` (`:398-403`) | `finalize('endedEarly', false, aliveUntil)` | `finalize(..., origin: 'abandon')`: silent, saved per mode |
| `isTimelineExhausted` (`:163`; `restore` `:378`; `index.ts:192`) | timeline-relative | `mode.exhausted(events, now)`, via `isExhaustedOnResume`; open is the 4 h cap, judged at `aliveUntil` |
| `isSnapshotFresh` (`resumable.ts:87-91`; `index.ts:193`) | plan length + 30 min | `mode.resumeWindowMs()`; open is 4 h |
| `resumeDispositionOf` (`field-test.ts:40`) | field test `offerable: false` | `planOf(key) → { plan, offerable }`, same rule |
| `rebuild` key check (`:634`) | `state.sessionKey !== session.key` | `keyOf(plan)`: `session.key`, or `'free-run'` |
| `session.key` reads (`:317, 320, 474, 634, 647, 698, 774, 834`) | a plan session is assumed | `keyOf(plan)` |
| `useSegmentClock` (`run.tsx:65`) | reads countdown fields unconditionally | runs only inside the scripted child view; the open view has `useElapsedClock` |
| `ResumableRun.session` (`index.ts:117`), `resume-run.tsx:46` | `PlanSession`, `sessionTitle` | `RunPlan`, `runTitle` |

`ScriptedMode` holds today's code for each row, verbatim. The engine keeps the event log, active
time, pause and resume, GPS ingest, flushing, sensors and persistence.

The "Becomes" names are the design; stage 2 shipped them as `position`, `view`, `takeCues`,
`exhausted`, `finalize(…, origin)` and `cueState`, and its plan lists which rows stage 3 still moves.

**Snapshot.** `RunSnapshot = ScriptedRunSnapshot | OpenRunSnapshot`, built on a shared base: `mode`,
`status`, `sessionKey`, `activeElapsedSeconds`, `distanceM`, `savedRunId`, `saveFailed`,
`elapsedAnchorMs` and `lastOutcome`. The open branch adds `motion`, `rollingPaceSecPerKm`,
`gpsStale` and `endDiscards` (stage 3a, ADR 0026's amendment). `IDLE_SNAPSHOT` is scripted-shaped,
with `mode: 'scripted'`.

**Why stage 2 ships no behaviour change.** Stage 2 keeps `start(PlanSession)` and
`restore({ session })`, and keeps the snapshot flat with `mode: 'scripted'`. `engine.test.ts` calls
`start` about 105 times and reads countdown fields about 25 times. With the signature and the flat
shape unchanged, it passes with no assertion changed, and `bun run typecheck` stays green. The union,
`start(RunPlan)` and the open mode arrive in stage 3.

## 4. The classifier and its evidence

### 4.1 Signal

The Kalman velocity from `smoothFix`, exposed as `SmoothStep.smoothedSpeedMps`. It is updated at
`geo.ts:289-317`, before the deadband check at `:332`. It is therefore not the committed distance
that the [stationary-time design](2026-08-05-pace-chart-stationary-time-design.md) could not classify
from. Velocity-gate nulls are at most 1 per capture, and restarts at most 2. After a pause, a stale
velocity decays within about 3 s. The Kalman lag grows with reported accuracy: crossing 1.0 m/s takes
2, 5, 7 and 9 s at 3, 10, 20 and 30 m accuracy.

`fix.speed` is not used. It is `-1` (unknown) on iOS and optional on Android, and the finalize fold
recomputes the velocity anyway.

### 4.2 Data and method

The captures are gitignored (`field-data/`, plus four in the owner's Downloads) and none are
committed. The inputs:

- **8 plan runs, weeks 2–4.** Their script provides the labels.
- **4 field tests.** They serve as standing evidence, but they are **indoor**, and two of them
  include walking (a stairwell protocol).

The replay runs `accuracyFilter` + `smoothFix` and takes `hypot(vx, vy)` on each accepted,
non-restarted step. Replayed distance equals each capture's recorded distance exactly. Accounting is
per fix; the median interval is 1.00 s on plan runs, so time-weighting changes nothing there.

Speed on the plan runs, in m/s. "Walk" means walk intervals only; warm-up and cool-down are separate.

| | p05 | p50 | p95 |
| --- | --- | --- | --- |
| walk intervals | 1.40 | 1.74 | 2.19 |
| run | 1.92 | 2.54 | 2.99 |
| standing (field tests) | 0.02 | 0.24 | 0.69 |

The overlap between walking and running moves with the day. On `2d8d4091` (w4d1) the median run was
2.23 m/s, while three days earlier it was 2.72. This is why the threshold is learned, not fixed.

### 4.3 The reducer

`src/domain/run-motion.ts`, pure (`bun test`).

- **Start state.** None until the first non-null speed; then the kind that speed implies.
- **Target.** A speed below 0.5 m/s means stopped. From stopped, the runner stays stopped until the
  speed exceeds 0.8. Otherwise the speed is run if at least `T`, else walk. Any kind can change
  directly into any other.
- **Candidate.** A target that differs from the current kind starts a candidate. The candidate can
  retarget (run, then walk, then stopped) without resetting its start. A sample "agrees" when it
  differs from the current kind. The candidate is confirmed on a sample that still differs, once 8 s
  of fix time have passed since it began and at least 70% of its samples agreed. The confirmed kind is
  the one most of its samples implied, ties going to the latest, so one noisy sample cannot pick it.
  A change that has already reverted by the 8 s mark is not confirmed, and a candidate is dropped
  when its agreement falls below 70%.
- **Boundary.** A confirmed boundary is backdated to the candidate's first sample.
- **Null speed.** A null speed holds the current kind.
- **Pauses.** A fix that falls after a pause boundary clears the candidate. In open mode the smoother
  also restarts on resume, both live and in the fold, so distance moved while paused is not counted.
- **The step and the fold.** `openTrackStep(state, fix, { T, paused })` is one fix through the
  smoother and the reducer: the pause restart and the gap rule live here, and the live engine calls
  it. `rollupOpenTrack(fixes, { T, paused, startMs, endMs })` folds the same step and returns
  `{ distanceM, points, buckets }`:
  - Fixes after `endMs` are ignored. Fixes stamped just before `startMs` are kept, because the
    engine ingests a cached first fix; their distance goes to the first bucket.
  - A fix stamped at or before the smoother's last accepted fix, or inside a pause, is ignored:
    it describes no active movement, and would otherwise read as a gap to the next fix.
  - Buckets tile `startMs`…`endMs`. A run with no velocity at all (no GPS, or two fixes or
    fewer) has no buckets, and no distance to attribute.
  - A fix on a boundary closes the earlier bucket: a delta is the leg ending at its fix, so buckets
    are `(start, end]`. Stage 3's `segment_seq` rewrite must use the same rule.
  - A GPS gap longer than `MAX_GAP_S` becomes stopped time.
  - Each committed delta goes to the bucket of the fix that ends it, so the buckets' distances sum to
    `distanceM`.
  - Each bucket's `durationS` is its active seconds rounded by largest remainder, so they sum to the
    run's rounded active time (`activeDurationS`).
  - **Stage 3 must restart every other re-fold at resumes too.** `smoothTrackBySegment`,
    `smoothTrackForRender` and `toRunProfile` do not restart at a pause, so over a free run with a
    pause shorter than `MAX_GAP_S` they would count the chord this fold excludes. Finalize uses this
    fold for a free run's distance; the summary's route and chart re-folds get the paused intervals
    (`use-run-track.ts` already loads them) or the saved total and the chart's extent disagree.

### 4.4 The learned threshold

When a free run starts, `T` = ½·(walk p90 + run p10) over the runner's last 3 completed plan runs:

- only walk and run intervals count;
- the first 10 s of each interval are dropped, because runners react late to the cue;
- samples at or below 0.8 m/s are dropped too: a runner standing inside a scripted run would
  otherwise drag the run p10 down (on `19615682` it fell to 1.49 m/s, and agreement to 60%);
- at least 60 samples of each kind are needed, otherwise `T` = 2.1 m/s;
- `T` is clamped to 1.5–3.0 m/s, so a thin or odd history cannot label ordinary walking as running.

`T` is written to `run_log` (`motion_threshold`) and read back at finalize, so a run is always
re-bucketed with its own `T`.

Each plan run was scored with a `T` learned only from the runs before it. The table is the output of
`bun scripts/replay-free-run-motion.ts field-data/*.txt ~/Downloads/runbro-*.txt` at stage 1:

| run | prior runs | T (m/s) | interval agreement | run pace (script → detected) |
| --- | --- | --- | --- | --- |
| `3ff243b0` w3d3 | 0 | 2.10 | 99.9% | 6:32 → 6:28 |
| `38f9634f` w3d1 | 1 | 2.01 | 96.7% | 6:35 → 6:39 |
| `98459df2` w3d1 | 2 | 2.16 | 100.0% | 6:42 → 6:40 |
| `b4ae7b11` w3d2 | 3 | 2.15 | 100.0% | 6:04 → 6:01 |
| `d8190994` w4d1 | 3 | 2.17 | 100.0% | 6:04 → 6:02 |
| `19615682` w2d1 | 3 | 2.17 | 92.0% | 7:09 → 6:22 |
| `d2e6a7b8` w4d2 | 3 | 2.15 | 95.1% | 6:20 → 6:13 |
| `2d8d4091` w4d1 | 3 | 2.06 | 94.8% | 7:23 → 7:19 |
| **mean** | | | **97.3%** | 7 of 8 within 2% |

The mean was 97.5% before the stage-1 code review: dropping stopped samples from learning raised `T`
slightly for runs whose history includes `19615682` (`2d8d4091` fell from 96.1% to 94.8%). That is the
price of not collapsing `T` for a runner who stops inside scripted runs. Field tests: 99.6% of active
time is labelled stopped (the harness measures time; the scratch measurement below counted fixes).

"Interval agreement" counts walk and run intervals only, excluding the first 10 s of each. The
`19615682` gap is the runner stopping inside a scripted run segment: the script counts the stop as
running, detection does not.

The learning formulas compared, as mean held-out agreement (the scratch measurement, before the
stage-1 review's fixes):

| formula | agreement |
| --- | --- |
| ½·(walk p90 + run p10) | **97.5%** |
| ½·(walk p75 + run p25) | 96.5% |
| ½·(walk median + run median) | 94.3% (70.1% on the tired day) |
| walk p90 | 93.8% |
| fixed 2.1 m/s (revision 1, with hysteresis) | 91.4% on intervals |

A 0.1 m/s hysteresis band around `T` scored the same as none, so it was dropped.

**Boundaries.** Detected boundaries fall after the scripted cue by 5–7 s at p50 and 11–12 s at p90,
for both directions (revision 1: 9.5 s p50 and 31 s p90 for run→walk). Runners' raw speed changes
about 3 s after the cue, so the saved boundary is about 2–4 s late at p50.

**Stops.**

- **Synthetic stops.** In a run at 2.5 m/s, stops of 10, 15, 20 and 30 s are labelled stopped for
  every second. Revision 1 labelled 10–15 s stops as walking.
- **Field tests.** 98.7% of field-test fixes are labelled stopped.
- **Slow walker after a 20 s stop.** At 0.8, 0.9 and 1.0 m/s, 7%, 3% and 0% of the walking is
  labelled stopped. Revision 1 trapped a 0.9 m/s walker in stopped for 77% of the walk.
- **Stops in the plan runs.** They are mostly GPS acquisition at the start and standing after the
  cool-down. Only `19615682` has a mid-run stop. No capture has a stop at a crossing or a pause
  mid-run. Stage 1 asks for both before its constants are frozen.

## 5. Surfaces

### 5.1 Entry and start sheet

- **iOS.** A `Stack.Toolbar` right button on the Plan stack (`figure.run`, accessibility label "New
  free run").
- **Android.** A `.android` fork of `src/app/(tabs)/(index)/_layout.tsx` renders
  `FreeRunHeaderButton`, a domain component (`src/components/`, ADR 0013) using `Pressable` +
  `SymbolView` with an `{ ios, android }` symbol pair, as `headerRight`. Per ADR 0025's route
  rule, the component also needs a never-rendered `.ios.tsx` stub.
- **Both platforms.** The button is disabled while `ResumeRunGate` is still checking or a resume
  offer is open. It pushes `/free-run`: a root-Stack `formSheet` registered in
  `src/app/_layout.tsx`. The sheet contains:
  - the heading "Free Run";
  - one line of explanation;
  - the location state;
  - "Start Free Run", which reuses the session sheet's double-tap guard and JIT location ask (ADR
    0008), then calls `runEngine.start({ mode: 'open', key: 'free-run' })` and
    `router.replace('/run')`.

  On Android, the sheet's content gets `android:pb-safe-offset-6`.

### 5.2 Run screen

- **`run.tsx`.** It delegates to `ScriptedRunView` or `FreeRunView`, so each keeps its own hooks.
- **`FreeRunView`.**
  - The count-up clock uses the Skia digits, driven by `useElapsedClock`.
  - The label reads Waiting for GPS, Timer only, Running, Walking or Stopped. It shows "Waiting for
    GPS" when there is no non-null speed for 10 s while location is granted.
  - Distance is shown.
  - Rolling pace is the mean Kalman speed of the moving samples in the last 45 s. It shows "—" while
    stopped or stale.
- **`RunTransport`.** Both platform versions take `showSkip`. For an open run, End opens Save /
  Discard / Cancel. A run under 1 min of active time is discarded on End without asking.
- **Shared.** Location banner, lock and screen-awake logic are shared.

### 5.3 Summary, Log, chart

- **Title.** "Free run" everywhere, via `runTitle`.
- **Stat grid.** A free-run variant: Active Time, Moving Time, Distance, Run Pace, Walk Pace, Moving
  Pace, plus Elevation Gain as today.
- **Bucket timeline.** A free run shows `SegmentBreakdown` as the bucket timeline, and no per-bucket
  split rows, because a free run can have dozens of buckets.
- **Stopped kind.** `stopped` needs an entry wherever a stored row's kind is looked up:
  - `SEGMENT_KIND_LABEL` (`src/domain/format.ts`, used by `segment-splits.tsx:52`);
  - `SegmentColors` and `SegmentSymbols` (`src/constants/theme.ts`), and the Android Material
    palette mapping (`use-theme.android.ts`);
  - `route-render.ts`, `segment-breakdown.tsx` and `segment-legend.tsx`;
  - `RunStatsSegment` (`run-stats.ts`).

  `bestRunSegment` is not shown for free runs.
- **Chart.** Run and walk bands shade the x-axis. Each stopped bucket is a minimum-width marker at
  its distance. The carry-forward in `toRunProfile` is untouched. All of this lives only in
  `run-profile-chart.tsx` (ADR 0024).
- **Route and export.** Both are coloured and labelled by bucket, because finalize rewrites
  `segment_seq`.

### 5.4 Cues

`kilometre` is a milestone cue. `CueService.announce(cue, data?: { km; paceSecPerKm })`, and
`kilometrePhrase` in `cues.ts` renders "1 kilometre. 6 minutes 40 per kilometre." or "2 kilometres…".
`CUE_PHRASE.kilometre` is the fixed fallback, "Kilometre.", which a pre-recorded adapter can play
(ADR 0009). `CUE_HAPTIC.kilometre` gets a pattern. The milestone-cue copy in Settings (`settings/index.tsx:51`,
`index.android.tsx:60`) gains the kilometre cue. An open run speaks `complete` on End and on
auto-end, and `resuming` on resume, like a plan run.

## 6. Health

- **`segmentWindows(rows, events, startedAtMs)`.** A pure function that returns wall-clock windows:
  - split at pauses, with nothing written for the paused span;
  - clamped to the workout;
  - non-overlapping and strictly positive; zero-length windows are dropped.

  The mapping: a plan warm-up, walk or cool-down becomes walking; a run becomes running; a skipped
  segment with actual time above 0 keeps its window; a free run's stopped bucket becomes rest
  (Android). `services/health/sync.ts` loads the run's segment rows and event log for it.
- **Android, stage 5a.**
  - `bun patch react-native-health-connect` so that `ReactExerciseSessionRecord.kt` builds `segments`
    from a `segments` key, and open the same change upstream.
  - `toExerciseSessionRecord` writes `ExerciseSegmentType.RUNNING` (46), `WALKING` (64) and `REST`
    (44), with `repetitions: 0`.
  - If `insertRecords` rejects the record, the adapter retries without segments.
  - The patch moves the Android fingerprint (Android is not on Play yet).
  - **Verification.** The emulator's Health Connect data browser, plus a debug-only readback through
    `readRecords` that asserts the segments. Whether the browser shows segments is not confirmed.
- **iOS, stage 5b.** A spike first. It must show, on a device:
  1. a walk/run distinction visible in Health or Fitness;
  2. the route attached after a finish with the phone locked (`finishWorkout` returns nil when
     protected data is unavailable, so this may need a deferred save; that would conflict with ADR
     0011's no-silent-retry rule, so it would need an amendment);
  3. sync-identifier replacement for the workout **and** its route (tag the route
     `${runId}:route`).

  If all three hold, `modules/workout-writer/` replaces `saveWorkoutSample` + `saveWorkoutRoute` in
  `adapter.ios.ts`. The builder calls are `beginCollection` → `add` → `endCollection(withEnd:)` →
  `finishWorkout`, with metadata set through `addMetadata`. Otherwise iOS keeps today's workout and
  ADR 0026 §8 is amended.
- **Both platforms.** The whole-run distance sample stays single (ADR 0011 item 7). There is no
  backfill. Re-saving to test replacement needs a debug hook, because `isHealthWritable` refuses a
  saved run.

## 7. Stages

Each stage merges as a working app. Maestro cannot produce GPS motion (ADR 0001), so buckets, pace and
the kilometre cue are verified by replay tests, and by driving GPS by hand on iOS
(`xcrun simctl location <udid> start --speed=…`) and Android (`adb emu geo fix` stepping).

| # | Stage | Ships | Verified by |
| --- | --- | --- | --- |
| 1 | **Classifier** | `smoothedSpeedMps`; `run-motion.ts`; the learned threshold (`learnThreshold`); `bucketStats`; a replay harness over the captures (a plain `bun` file, not a `package.json` script, since scripts are fingerprint-hashed). Asks the owner for a capture with a crossing stop and a mid-run pause before the constants are frozen. No app change. | `bun test`; the harness reproduces §4.4. |
| 2 | **Engine refactor** | `RunMode` and `ScriptedMode`, and `mode: 'scripted'` on a flat snapshot. **No behaviour change.** `RunPlan` arrives with `OpenMode` in stage 3: its open variant would be dead code here. | `engine.test.ts` with no assertion changed; both typechecks; the `session`-tagged Maestro flows on iOS and Android. |
| 3a | **Engine and persistence** | `OpenMode` and `modeFor`; the snapshot union; the derived finalize with the `segment_seq` rewrite; `deriveOpenRun` (cap, stopped trim, under-a-minute discard); hard-delete discard; `planOf` and the 4 h resume; the learned-threshold reader; the pause rule in every re-fold; the `stopped` kind's label, colour and symbol; the ADR 0007 and 0021 amendments. No entry point, so the app is unchanged. | `bun test` (open mode, derived finalize under `bun:sqlite`, `deriveOpenRun`); the differential old-vs-new engine harness for plan runs. [Plan](../plans/2026-09-29-free-run-stage-3a-engine-persistence.md). |
| 3b | **The surfaces** | The header button, sheet, `FreeRunView` and `showSkip`; the Save / Discard / Cancel End dialog (Android: Discard in the dialog body); the free-run stat grid; `runTitle`; the resume sheet's copy. | `free-run.yaml` and a discard flow (below), waiting out the minute; a manual GPS drive on both platforms. |
| 4 | **Chart and cue** | Chart bands and stop markers; the `kilometre` cue; Settings copy; the ADR 0009 amendment. | `bun test`; a drive past 1 km; light and dark screenshots on iOS and Android. |
| 5a | **Health segments, Android** | `segmentWindows`; the library patch; exercise segments for plan and free runs; the ADR 0011 amendment. Depends only on stage 1 and can ship any time after it. | Readback through `readRecords`; the Health Connect data browser. |
| 5b | **Health segments, iOS** | The spike, then `modules/workout-writer/`, or an amendment dropping it. | §6's three criteria on a device. |

## 8. Testing

- **Classifier.**
  - Hover at 2.05–2.15 m/s with measured noise (SD 0.18): recall of run time, and walk pace.
  - Direct run↔stopped at crossings of 10–45 s.
  - A slow walker at 0.8–1.2 m/s after a stop.
  - A candidate that retargets.
  - Null speed holding the kind; pause clearing the candidate; the smoother restarting on resume.
  - Bucket distances summing to the smoothed distance; active seconds summing to `activeDurationS`.
  - Live fold, batch fold and a fold resumed mid-stream agreeing.
  - Every fixture carries noise, following the stationary-time design's lesson.
- **Threshold.** The formula; the 60-sample floor; the fallback; trimming the first 10 s; warm-ups
  and cool-downs excluded; `T` round-tripping through `run_log`.
- **Stats.** Pace is always a sum of distance over a sum of time; stopped distance is excluded from
  moving pace; no buckets gives no paces.
- **Engine.**
  - Stage 2 keeps the whole existing suite with no assertion changed.
  - Open mode never auto-completes.
  - End saves `completed` and speaks `complete`; abandon saves `completed` silently.
  - Discard saves nothing; under 1 min is discarded; the 30-min-stopped auto-end trims the run; the
    4 h cap ends it.
  - Resume at 3 h 59 min is offered and at 4 h 01 min is not.
  - The field test keeps `offerable: false`.
  - A free-run key never marks a plan day.
  - The kilometre cue fires once per kilometre and never on a scripted run.
- **Health.** `segmentWindows` across pauses, skips, a run ended mid-segment, and zero-length
  windows; the Android retry without segments.
- **E2E: `free-run.yaml`.**
  - Tagged `session`, and runs on both lanes.
  - Permissions include `location: inuse` with `motion: allow` on iOS, and the Android equivalents.
  - Flow: tap the "New free run" button → assert the heading "Free Run" → tap "Start Free Run" →
    assert that the clock counts up (not a bucket label, which depends on timing) → pause and resume
    → End → Save → assert the summary by its "Moving Pace" tile, not by its title (the Plan header's
    label stays in the accessibility tree behind the modal) → open the Log row "Free run" → back on
    Plan, the next session is unchanged.
  - A second flow: End → Discard → the Log has no new row.

## 9. Limits, stated plainly

- The threshold learns from plan runs. A runner who has not done any gets 2.1 m/s (7:56 min/km), so a
  slower jog is labelled walking until three plan runs exist.
- Every measurement comes from one runner on one phone in weeks 2–4, and the standing evidence is
  indoor.
- The live label lags by about 8 s. Saved boundaries are about 2–4 s late at p50 and up to about
  8 s at p90.
- Walking near 0.8 m/s just after a stop is sometimes labelled stopped (7%).
- A kilometre can be announced twice after a resume if an unflushed tail was lost.
- iOS Health segments may not ship at all (stage 5b's kill criterion).

## 10. Review record

**Revision 1** was reviewed by four adversarial agents on 2026-09-29, each with its own lens:
evidence, engine, Health, and the spec's premises. Confirmed findings, and where each landed:

- **Route colouring.** A free run's route would have drawn in one colour: every point was tagged 0,
  and route chunks join on the tag (`geo.ts:495`, `route-render.ts:23`). Found independently by two
  reviewers. → finalize rewrites `segment_seq` (ADR §4).
- **Health Connect.** The library's Kotlin ignores `segments` (`ReactExerciseSessionRecord.kt:48,55`).
  Revision 1 had verified only the constants. → a patched library (owner).
- **iOS Health.** Apple's APIs cannot label walking inside a running workout, and a locked-phone
  `finishWorkout` returns nil, which loses the route. → a spike with kill criteria (owner).
- **Classifier transitions.** The reducer had no run↔stopped edge, so a 10–15 s stop at a crossing
  read as walking. Its candidate reset starved a 2.10 m/s jogger (5 of 34 run segments never
  confirmed). The stopped exit at 1.0 m/s trapped a 0.9 m/s walker for 77% of their walk. →
  §4.3's direct edges, majority rule, retargeting and 0.5/0.8 stopped band.
- **Threshold.** A fixed 2.1 m/s fails slower C25K joggers. → learned threshold (owner). The
  hysteresis band was never tested at 0; → tested, then dropped.
- **Statistics.** 93.4% was inflated by the easy warm-ups and cool-downs (91.4% on intervals) and
  deflated by label lag. The standing captures are indoor, and the "stops at crossings" claim was
  wrong. → §4.2 and §4.4 restated.
- **Missed engine sites.** The six-site table missed more than ten sites, among them the saved-duration
  cap (an open run would have saved 0 s), altitude tags, the snapshot parser orphaning the `'active'`
  row, and the field test's `offerable`. → §3.
- **Cues on abandon.** A crashed free run would have spoken "Workout complete" at launch. → a finalize
  origin (ADR §1).
- **Stage 2's proof.** It was unachievable as written, because the test file's typecheck breaks on a
  new `start` signature. → §3's flat stage 2.
- **Kilometre cue.** A free-text phrase broke ADR 0009's IDs-only port. → typed cue data (ADR §7).
- **Stopped on the chart.** Stopped time has no width on a distance axis. → markers (owner).
- **Accidental and forgotten runs** would be permanent and written to Health. → safeguards (owner).
- **Stage 3** would not compile without stopped labels, and 5a did not depend on stages 2–4. →
  §7 resequenced.

Rejected: none of the confirmed findings. Deferred: nothing.

**Stage 1's code** had three more adversarial reviews before merge. An executed property-based run
(8,000 random fix streams) found four Majors, all fixed: an out-of-order fix corrupted the buckets
(negative durations); fixes stamped inside a pause were counted; `T` collapsed for a runner who stops
inside scripted runs; and the fold dropped the pre-start fixes the engine ingests, so live and saved
distance disagreed on every capture. It also led to confirming a candidate by plurality. After the
fixes, the same property suite passes all 8,000 cases.
