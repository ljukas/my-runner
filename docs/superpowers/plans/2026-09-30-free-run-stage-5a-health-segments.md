# Free run — stage 5a: Health Connect segments

Date: 2026-09-30
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §6 · ADR:
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) §8,
[0011](../../adr/0011-apple-health-kingstinct-healthkit.md) · depends only on stage 1 (merged), so
it branches from `main`, not from 3c/4

## Goal

A run saved to Health Connect carries what the runner did inside it: running, walking, standing
still and pausing, as exercise segments, for plan and free runs alike. iOS keeps its single
workout until stage 5b's spike.

## Owner decisions (2026-09-30)

- **Pauses become PAUSE (39) segments.** ADR 0026 §8 said nothing is written for a paused span;
  Health Connect subtracts PAUSE and REST segments from a session's exercise duration, so without
  them every pause counted as exercise time (upstream #277 cites AOSP's
  `SessionDurationAggregationData`).
- **A free run's stopped buckets become REST (44)**, as specified, although the app counts stopped
  time as active time: Health Connect's figure then means moving time.
- **The readback that proves the segments landed is temporary**, not committed.
- **The patch has the shape upstream issue
  [#277](https://github.com/matinzd/react-native-health-connect/issues/277) proposes** (laps from
  `"laps"`, segments from `"segments"`), so it drops out when upstream ships the fix; a comment on
  #277 with the emulator evidence is drafted for the owner before it is posted.
- **Architecture: the clean design.** The workout payload carries two platform-neutral facts,
  `segments` (running, walking, resting) and `pauses`; only the Health Connect mapper knows pauses
  are segments there, since HealthKit models them as pause/resume events (stage 5b).
- **The iOS fingerprint moves, accepted.** `@expo/fingerprint` hashes `patches/` for both
  platforms, so ADR 0026's "moves only Android's" was wrong; ignoring the directory was offered and
  declined.

## Design

- **Pure** (`bun test`): `domain/health-segments.ts` — `segmentWindows(rows, events, workout)` lays
  the stored rows' active seconds end to end through the event log (`wallClockAtActive`), splits
  them at pauses, clamps them to the workout and keeps them ordered and non-empty; a tail the rows
  fall short of stays uncovered rather than stretched; without an event log the rows are laid from
  the start. `pauseWindows(events, workout)` clamps `pausedIntervals`, running a pause the log
  ended in to the workout's end. warm-up, walk and cool-down → walking, run → running, stopped →
  resting.
- `toHealthWorkout(run, fixes, segmentRows)` fills `segments` and `pauses`;
  `HealthRunInput` gains `eventLogJson`. `db/run-segments.ts` loads the rows for `sync.ts` (mocked
  beside `@/db/run-points` in both health test files, since `mock.module` is global).
- **Health Connect** (`health-connect.ts`): `toExerciseSegments` merges both lists in time order
  as RUNNING 46 / WALKING 64 / REST 44 / PAUSE 39 with `repetitions: 0`, the numbers restated like
  the existing three; the session omits the key when empty. `insertExerciseSession(insert, record)`
  inserts once more without `segments` if the insert with them is refused as invalid
  (`ARGUMENT_VALIDATION_ERROR`), within the same save (no silent retry, ADR 0011's Consequences);
  the adapter passes `insertRecords` in.
- **The patch** (`patches/react-native-health-connect@4.1.3.patch`, via `bun patch`): two keys in
  `ReactExerciseSessionRecord.parseWriteRecord`.

## Commits

1. `feat:` segment windows, the Health Connect mapping and the fallback, with tests.
2. `build:` the library patch (`package.json` `patchedDependencies`, `bun.lock`, `patches/`).
3. `docs:` this plan, ADR 0011 and 0026 amendments, AGENTS.md.

## Verification

- `bun test`, both typechecks, lint.
- Fingerprints before/after: iOS `fd770db…` → `9d09364…` unset, `bcd744b…` → `4cf7631…`
  `development`, `aca9e74…` → `9419024…` `e2e` (only the `patches` source is new); Android unset
  `f1019d0…` → `6bb185f…` (the package's sources and `patches`).
- On the emulator (Pixel 10 Pro, API 37, platform Health Connect), with an arm64 Gradle build and a
  temporary readback in the adapter (`readRecords('ExerciseSession', { dataOriginFilter: [own
package] })` — no READ permission needed for the app's own records).
- Adversarial review before the PR.

## Found on device (2026-09-30)

- **Plan run** (W1D1: warm-up skipped at 10 s, a 15 s pause inside the first run, End in the
  walk): sent and read back identically, to the millisecond — walking, running, **pause**, running,
  walking. The summary's Active Time read 52 s against a 67 s session.
- **Free run** (adb geo fix: run, stand, walk, run, with a 15 s pause): walking, running, **rest**,
  walking, **pause**, walking read back identically. So an ordinary app may write PAUSE segments —
  the question #277 left open.
- **Health Connect's data browser lists them.** Entry details under Exercise shows an "Exercise
  segments" section (Walking, Running, Pause, …); the spec had it unconfirmed.
- **The fallback:** a segment forced outside the session was rejected
  (`IllegalArgumentException: segments can not be out of parent time range.`); the adapter warned,
  saved the session without segments, and the summary read "Saved to Health Connect".
- **Not verified:** that Health Connect's `EXERCISE_DURATION_TOTAL` subtracts the pause and rest
  segments. An aggregate filtered to the app's own package returned 0 s with no data origins —
  aggregates apparently need the READ permission this app does not hold. The subtraction rests on
  AOSP, as cited in #277.

## Found in review (2026-09-30)

Four reviewers (correctness with a shell, ADR compliance, comment density, simplicity). No Critical
or Major. The correctness review read androidx `connect-client` 1.1.0's validation from its
bytecode and fuzzed 400k inputs (pauses, skips, a log ending paused, clock skew, rows short, over
or unsorted) through `toExerciseSegments` against it: nothing the engine can produce is rejected.
Fixed:

- **The fallback retried on any failure,** so a transient one followed by a successful retry lost
  valid segments for good; it now retries only on `ARGUMENT_VALIDATION_ERROR`.
- **A segment read that threw failed the whole save** (iOS included, which ignores segments); it
  now costs only the segments.
- **Bucket durations drifted from their boundaries** under largest-remainder rounding (median
  0.7 s over 10 buckets, 2.5 s over 120); stage 1's `toBuckets` now rounds by running total, every
  boundary within half a second (ADR 0026's stage-5a amendment).
- Docs: ADR 0011's moved facts (the builder's third argument, four files referencing the library,
  seven restated constants), the upstream step (a #277 comment, not a PR), the unverified duration
  subtraction hedged in the ADR and the mapper's JSDoc, per-variant fingerprints; `SegmentRow`
  extends `RunStatsSegment`; a stale type comment.

Not changed: a defensive merge in the mapper for inputs the engine cannot produce (backwards
clocks, sub-millisecond instants), and the non-finite-duration guard, dropped because
`actual_duration_s` is `integer().notNull()`.
