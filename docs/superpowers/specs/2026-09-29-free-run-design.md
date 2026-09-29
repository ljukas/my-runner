# Free run — design

Date: 2026-09-29
Status: **design — for review**
Decision record: [ADR 0026](../../adr/0026-free-run-open-mode-motion-buckets.md). This spec is the
how and the when: owner decisions, the measurement behind the thresholds, and the delivery stages.

## 1. What this is

A **free run** is a run started any time from the Plan tab, with no scripted intervals, ended by hand.
While it runs, the app tells running, walking and stopped apart from GPS speed. The saved run carries
those buckets, so the summary can show run pace, walk pace and moving pace instead of one blended
average.

It is **not** [ADR 0018](../../adr/0018-free-run-route-generation.md)'s route generation. That feature
(target distance → suggested loop) layers on top of this mode later, through `OpenMode.goal`.

## 2. Owner decisions (2026-09-29)

Asked as structured questions; recorded here so implementation does not re-open them.

| Area | Decision |
| --- | --- |
| Detection | Automatic, from smoothed GPS speed. No cadence in this feature. |
| Threshold | Fixed, ~2.0 m/s between walk and run, with hysteresis. No setting. |
| Buckets | Run, walk, stopped. Stopped counts as active time, is excluded from pace and moving time. |
| Summary | Run pace, walk pace, moving pace. The pace chart shows all buckets. Plan-run summaries unchanged. |
| Run screen | Count-up clock, current bucket, distance, rolling pace. No progress bar, no Skip. |
| Ending | Always saved as `completed`, including a crashed run that is not resumed. |
| No location | Allowed, timer-only. |
| Cues | Paused/resumed, plus a new per-kilometre cue. Kilometre cue for free runs only. |
| Health | Workouts carry run/walk segments — for free runs **and** plan runs, both platforms. |
| Crash resume | Offered, up to ~4 h after the last flush. |
| Entry | A button in the Plan tab's header. |
| Architecture | Clean: a `RunMode` strategy in the engine (ADR 0026 §1), not flags. |
| Delivery | This design PR first, then implementation in stages, each a working app. |

Out of scope: detection on plan runs, a target distance or route, cadence, auto-pause, a threshold
setting.

## 3. How it fits the existing engine

The engine is an event log plus a timeline ([ADR 0007](../../adr/0007-run-engine-event-log.md)). Six
places treat the timeline as the run's definition, and each becomes a `RunMode` method:

| Today (`src/services/run-engine/engine.ts`) | `RunMode` method | `OpenMode` |
| --- | --- | --- |
| `heartbeat` finalizes on `positionAt(...).done` | `position(elapsedS)` | never done |
| `refresh` caps elapsed at the total | `position` | no cap |
| `announceProgress`, halfway, last run | `cueTick(ctx)` | kilometre cue |
| `isTimelineExhausted` in `restore` | `exhausted(events, now)` | always false |
| `isSnapshotFresh` (`resumable.ts`) | `resumeWindowMs()` | 4 h |
| `finalize`'s segment list and status | `finalSegments(...)`, `finalStatus(requested)` | `[]` + `segmentation: 'derived'`; always `completed` |

`ScriptedMode` holds today's code for each row unchanged. The engine keeps everything else: the event
log, active time, pause and resume, GPS ingest, flushing, sensors, persistence.

The snapshot becomes `RunSnapshot = ScriptedRunSnapshot | OpenRunSnapshot`, discriminated on `mode`.
`OpenRunSnapshot` carries `activeElapsedSeconds`, `distanceM`, `bucket`, `rollingPaceSecPerKm`,
`savedRunId` and `saveFailed` — and none of the countdown fields.

Restoring after a crash: the persisted `sessionKey` maps back through `planOf(key)` —
`'free-run'` → `{ mode: 'open', goal: null }`, a plan key → its `PlanSession` — replacing
`resumeDispositionOf`'s field-test branch with one lookup. `rebuild()` re-folds the smoother **and** the
classifier over the persisted points, so the resumed label equals the live one.

## 4. The classifier and its evidence

### 4.1 Signal

The Kalman velocity from `smoothFix` (`src/domain/geo.ts`), exposed as `SmoothStep.smoothedSpeedMps`.
Not `fix.speed`: the platform reports `-1` (unknown) on iOS and may omit it on Android, and the
smoother's velocity is what the finalize fold re-computes, so live and saved agree.

This is a different signal from the one the
[stationary-time design](2026-08-05-pace-chart-stationary-time-design.md) rejected. That design
classified from *committed distance*, which the deadband withholds while slow. The velocity is updated
on every fix whether or not distance is committed.

### 4.2 Measurement

Method: replay `accuracyFilter` + `smoothFix` over each capture's `## points`, take
`hypot(vx, vy)` after each accepted, non-restarted step, and label it with the capture's own segment
kind (plan runs) or as standing (field tests). Captures are gitignored (`field-data/`, plus four in
the owner's Downloads); none are committed.

Kalman speed by segment kind, m/s:

| capture | session | walk p05 / p50 / p95 | run p05 / p50 / p95 |
| --- | --- | --- | --- |
| `3ff243b0` | w3d3 | 1.16 / 1.61 / 1.82 | 1.97 / 2.57 / 2.88 |
| `38f9634f` | w3d1 | 0.04 / 1.73 / 2.19 | 1.95 / 2.51 / 2.83 |
| `98459df2` | w3d1 | 1.26 / 1.72 / 2.16 | 2.06 / 2.47 / 2.80 |
| `b4ae7b11` | w3d2 | 1.40 / 1.72 / 2.06 | 2.22 / 2.74 / 3.06 |
| `d8190994` | w4d1 | 1.22 / 1.63 / 1.95 | 2.30 / 2.72 / 3.04 |
| `19615682` | w2d1 | 1.05 / 1.68 / 2.08 | 0.28 / 2.48 / 2.99 |
| `d2e6a7b8` | w4d2 | 1.12 / 1.60 / 2.01 | 1.98 / 2.67 / 3.06 |
| `2d8d4091` | w4d1 | 1.21 / 1.73 / 2.13 | 1.91 / 2.23 / 2.51 |
| **all** | | **1.09 / 1.67 / 2.10** | **1.92 / 2.54 / 2.99** |

Standing (four field tests, 2,859 fixes): p50 0.24, p90 0.59, p95 0.69, p99 0.95.

Classifier grid — hysteresis around a midpoint, minimum dwell, backdated boundaries; agreement is the
share of plan-run fixes whose detected run/walk matches the script (stopped counted as walk):

| midpoint ± band | dwell 5 s | dwell 8 s | dwell 12 s |
| --- | --- | --- | --- |
| 1.9 ± 0.1 | 91.3% | 90.6% | 84.5% |
| **2.0 ± 0.1** | 94.1% | **93.4%** | 91.2% |
| 2.1 ± 0.1 | 94.5% | 92.8% | 91.2% |
| 2.0 ± 0.2 | 92.7% | 88.7% | 81.8% |

Wider bands and longer dwells both lose: the distributions overlap around 2 m/s, so a wide band holds
the wrong kind, and a long dwell rarely confirms while the speed hovers. 8 s rather than 5 s because it
makes fewer spurious switches (81 vs 114 against 68 scripted transitions) for 0.7 points of agreement.
Stopped (enter < 0.7, leave > 1.0) catches 99.2% of field-test time and 2.1% of plan-run time — real
stops at crossings, visible as the low walk p05 on `38f9634f`.

Pace, with the chosen constants (2.1 / 1.9 / 0.7 / 1.0, 8 s):

| capture | run pace (script) | run pace (detected) | today's Avg Pace |
| --- | --- | --- | --- |
| `d8190994` w4d1 | 6:04 | 6:03 | 7:38 |
| `19615682` w2d1 | 7:09 | 6:31 | 8:54 |
| `d2e6a7b8` w4d2 | 6:20 | 6:19 | 7:48 |
| `2d8d4091` w4d1 | 7:23 | 7:19 | 8:17 |
| `3ff243b0` w3d3 | 6:32 | 6:28 | 8:32 |
| `38f9634f` w3d1 | 6:35 | 6:45 | 8:58 |
| `98459df2` w3d1 | 6:42 | 6:50 | 8:16 |
| `b4ae7b11` w3d2 | 6:04 | 6:10 | 7:52 |

Seven of eight within ±3%. The w2d1 gap is the runner stopping inside a scripted run segment: the
script counts that time as running, detection does not — detection is the closer to the truth there.

**Sample caveat**, as the stationary-time design put it: one runner, one phone, one city, weeks 2–4.
The walk p95 and run p10 touch at ~2.1 m/s. Another runner's fast walk or slow jog can sit in the band;
that is accepted with a fixed threshold (§2) and is the first thing to re-check on new captures.

### 4.3 The reducer

`src/domain/run-motion.ts`, pure, no Expo imports (`bun test`).

- State: the confirmed kind (initially walk), and an optional candidate `{ kind, fromIndex, sinceMs }`.
- A sample's target kind depends on the current kind (hysteresis): from walk, run needs ≥ 2.1 and
  stopped needs < 0.7; from run, walk needs < 1.9; from stopped, walk needs > 1.0.
- A target equal to the current kind clears the candidate. A new target starts one. A candidate held
  for ≥ 8 s of fix time is confirmed, and its boundary is the candidate's first fix — so the saved
  bucket starts where the change began, not where it was confirmed.
- `smoothedSpeedMps === null` (restart, velocity-gate reject) holds the current kind and clears the
  candidate. A pause clears the candidate.
- `rollupOpenTrack(fixes, activeSecondsOf)` folds the smoother and the reducer together and returns
  `{ distanceM, points, buckets }`, each bucket `{ seq, kind, startMs, endMs, activeS, distanceM }`.
  Each committed delta lands in the bucket containing its end fix, so `Σ bucket.distanceM ===
  distanceM`. `activeSecondsOf(startMs, endMs)` excludes paused time via the event log.

The constants live in one exported block. Stage 1 tunes them with the replay harness before anything
user-visible depends on them.

## 5. Surfaces

### 5.1 Entry and start sheet

- **iOS:** a `Stack.Toolbar` right button (`figure.run`, label "Free run") on the Plan stack
  (`src/app/(tabs)/(index)/_layout.tsx`).
- **Android:** an RN `Pressable` + `SymbolView` header action with an `{ ios, android }` symbol pair —
  SF-Symbol toolbar buttons render nothing on Android (`src/app/_layout.tsx` has the precedent).
- Both push `/free-run`: a root-Stack `formSheet` like `session/[key]`, registered in
  `src/app/_layout.tsx`. It holds one line of explanation, the location state, and "Start Free Run".
  Start reuses the session sheet's double-tap guard and just-in-time location ask, then
  `runEngine.start({ mode: 'open', goal: null })` and `router.replace('/run')`. Android pads the
  content with `android:pb-safe-offset-6` (a button ends the sheet).

### 5.2 Run screen

`run.tsx` narrows on `snapshot.mode`. The open branch renders `FreeRunReadout` (a domain component,
ADR 0013): the count-up clock (the Skia digits, counting up), the bucket label (Running / Walking /
Stopped; "Timer only" without location), distance, and pace over the last ~45 s of moving samples.
`RunTransport.ios` / `.android` take `showSkip`; the End dialog for an open run just confirms. The
location banner, lock and screen-awake logic are shared.

### 5.3 Summary, Log, chart

- Title "Free run" in the Log rows (both platforms), the summary header and the resume sheet, via
  `runTitle(sessionKey)`.
- `RunStatGrid`, free-run variant: Active Time, Distance, Run Pace, Walk Pace, Moving Pace (and
  Elevation Gain as today). `bucketStats` is pure and tested.
- `SegmentSplits` / `SegmentBreakdown` list the buckets; a stopped colour joins the kind map, as it does
  in `route-render.ts`.
- The pace chart shades x-axis bands by bucket, from the stored rows' cumulative `distanceM`; no new
  storage. The only victory-native file stays `run-profile-chart.tsx` (ADR 0024). The stationary
  carry-forward in `toRunProfile` is untouched.

### 5.4 Kilometre cue

`kilometre` joins `CUE_IDS` as a milestone cue. The phrase comes from `kilometrePhrase(km,
paceSecPerKm)` in `src/domain/cues.ts` ("2 kilometres. 6 minutes 40 per kilometre."), passed through a
new optional argument on `CueService.announce`. The pace is the last kilometre's moving pace. It obeys
the existing milestone toggle through `effectiveCue`.

## 6. Health

- `HealthWorkoutInput.segments: { kind: 'running' | 'walking'; startedAt; endedAt }[]`, built by a pure
  `segmentWindows(rows, events, startedAtMs)` that maps active-time offsets to wall clock through the
  event log, clamps to the workout, and never overlaps. `services/health/sync.ts` loads the run's
  segment rows and event log for it.
- Plan runs: warm-up, walk, cool-down → walking; run → running; skipped segments are dropped. Free
  runs: stopped is omitted.
- **Android:** `toExerciseSessionRecord` adds `segments` with `ExerciseSegmentType.RUNNING` (46) /
  `WALKING` (64) from `react-native-health-connect`'s `constants.ts`, `repetitions: 0`.
- **iOS:** `modules/workout-writer/`, a local Swift module writing through `HKWorkoutBuilder` — segment
  events or workout activities, decided by the spike — and the route through `HKWorkoutRouteBuilder`
  in the same module, since the library's route writer needs the library's workout proxy. It replaces
  `saveWorkoutSample` + `saveWorkoutRoute` in `adapter.ios.ts` only; reads, authorization and the
  sync-identifier replace semantics must survive (ADR 0011). It moves the iOS fingerprint.

## 7. Stages

Each stage merges as a working app. Maestro cannot produce GPS motion (ADR 0001, 2026-07-31
amendment), so buckets, pace and the kilometre cue are verified by replay tests and by hand — `xcrun
simctl location <udid> start --speed=…` on iOS, `adb emu geo fix` stepping on Android — and on the
device checklist.

| # | Stage | Ships | Verified by |
| --- | --- | --- | --- |
| 1 | **Classifier** | `smoothedSpeedMps`; `run-motion.ts` (`motionStep`, `rollupOpenTrack`); `bucketStats`; `segmentWindows`; a replay harness over the captures (a plain `bun` file, not a `package.json` script — scripts are hashed into the fingerprint). No app change. | `bun test`; the harness reproduces §4.2 and fixes the constants. |
| 2 | **Engine refactor** | `RunPlan`, `RunMode`, `ScriptedMode`; snapshot union with only the scripted branch reachable. **No behaviour change.** | `engine.test.ts` passes **unmodified**; full `session`-tagged Maestro suite on iOS and Android. |
| 3 | **Free run, end to end** | `OpenMode`; derived finalize and the widened enum; `planOf` and the 4 h resume; header button, start sheet, `FreeRunReadout`, `showSkip`; `runTitle`. Summary shows the buckets through the existing grid and splits. | Engine tests for open mode; new `.maestro/tests/free-run.yaml` (header → sheet → start → count-up → pause/resume → End → "Free run" summary and Log row → Plan's next session unchanged); manual GPS drive on both platforms. |
| 4 | **Pace and cue** | Free-run stat grid (run/walk/moving pace), chart bands, stopped colours, `kilometre` cue. | `bun test`; manual drive past 1 km; screenshots in light and dark, iOS and Android. |
| 5a | **Health segments, Android** | `segments` on the input; Health Connect exercise segments for plan and free runs. | Health Connect's data browser shows the segments (AGENTS.md recipe). |
| 5b | **Health segments, iOS** | Spike, then `modules/workout-writer/`; ADR 0011 amendment. Fingerprint moves. | A plan run and a free run in the Health app with their segments and route; re-save replaces rather than duplicates. |

## 8. Testing

- **Classifier:** hysteresis (a one-fix blip above 2.1 does not switch); dwell and backdating; restart
  and null speed hold; pause clears the candidate; `Σ bucket.distanceM === smoothTrack(...).distanceM`;
  live fold, batch fold and a fold resumed mid-stream give identical buckets.
- **Stats:** run, walk and moving pace are distance sums over time sums; stopped never enters moving
  pace; no buckets → no paces.
- **Engine:** the whole existing suite unmodified after stage 2; open mode never auto-completes; End
  and abandon both save `completed`; resume at 3 h 59 min is offered and at 4 h 01 min is not; the
  kilometre cue fires once per kilometre and never on a scripted run; a free-run key never marks a plan
  day (the `field-test.test.ts` pattern).
- **Health:** `segmentWindows` across pauses, skips, and a run ended mid-segment.
- **E2E:** `free-run.yaml` as in stage 3, tagged `session`, runnable on both lanes. Text anchors: the
  header button's accessibility label "Free run", the sheet's "Start Free Run", the summary title
  "Free run".

## 9. Limits, stated plainly

- Movement below ~0.7 m/s (about 24 min/km) is labelled stopped; its distance still counts, its time
  leaves pace. Standing noise reaches 0.69 m/s at p95 (§4.2), so no threshold does better.
- The live label lags a change by the dwell (≈8 s). The saved buckets do not.
- Thresholds come from one runner. Recheck them when captures from anyone else exist.
- iOS Health segments depend on a spike (stage 5b). If it fails, iOS keeps today's single workout and
  the ADR is amended.
