# Free run — stage 3a: engine and persistence

Date: 2026-09-29
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §3, §4.3, §5.2, §7 stage 3 ·
ADR: [0026](../../adr/0026-free-run-open-mode-motion-buckets.md) · stacked on stage 2 (#80)

## Goal

Everything a free run needs below the screens: `OpenMode`, its derived finalize, discard, the
safeguards, crash-resume and the re-folds. **No entry point**: nothing in `src/app/` starts a free
run, so the app behaves as `main` for users. Stage 3b adds the surfaces.

## Owner decisions (2026-09-29)

- Stage 3 ships as 3a (this) and 3b (UI), stacked.
- Discard is a **hard delete** of the run and its children (no FK cascade: children first).
- The Android End dialog is Save + Cancel with a Discard button in its body (3b).
- The free-run E2E flow waits out the 1-minute minimum; no test-only override (3b).
- Architecture: the **clean** 3a design — `RunPlan` everywhere, one `modeFor`, the snapshot union
  with live fields in 3a, one shared pause rule for every re-fold.

## Design

**Domain** (pure, `bun test`):

- `domain/free-run.ts` — `FREE_RUN_KEY = 'free-run'`, `RunPlan`, `OPEN_LIMITS` (1 min minimum,
  30 min stopped, 4 h cap, 4 h resume window), `runPolicy(sessionKey, paused)`.
- `domain/active-time.ts` — `activeElapsedMs` moves here from the engine folder, so domain code can
  derive active time; `wallClockAtActive` finds the instant a run reached a given active time.
- `geo.ts` — `FixPolicy` + `stepWithPolicy`: one rule for ignoring a fix and restarting the smoother,
  used by `openTrackStep` (via `pausePolicy`) and, for free runs only, by `smoothTrackForRender` and
  `toRunProfile`. No policy is the old behaviour, byte for byte.
- `domain/open-run.ts` — `deriveOpenRun`: the one place a free run's end is settled, whichever way it
  ended (runner, limit, abandon): fold, trim a trailing stop of 30 min or more, truncate the event log,
  decide save or discard (< 1 min).
- `run-motion.ts` — `OpenTrackStep.smoothedSpeedMps`; `learnThresholdFromRuns`.

**Persistence**:

- `db/derived-finalize.ts` — `writeDerivedFinalize` and `deleteRunTree`, over a
  `BaseSQLiteDatabase` like `flush-transaction.ts`, so they run under `bun:sqlite`: bucket rows, the
  `segment_seq` rewrite by timestamp with `(start, end]` semantics, deleting points after a trim, and
  the hard delete. `save-run.ts` delegates; `finalizeRun` returns a `FinalizeOutcome`.
- `db/motion-threshold.ts` — `loadLearnedThreshold()` over the last 3 completed plan runs.
- `with-health-sync.ts` — a discarded run never reaches Health.

**Engine**:

- `RunSnapshot = ScriptedRunSnapshot | OpenRunSnapshot` over a shared base.
- `RunMode` gains `ingest` (the mode's own fold), `live()`, `cuesSuppressed`, `canSkip`,
  `canDiscard`, `resumeWindowMs()`, `stateFields()`, `position(events, activeS, now)` with an origin,
  and `finalize` returning `endAt` and an outcome. `modeFor(plan, …)` is the one factory.
- `OpenMode` — never done by itself except at the limits (4 h active; 30 min stopped) with origin
  `limit`; saves `completed`; `takeCues` is empty until stage 4.
- `start(plan: RunPlan)`, `endEarly(intent)` with `'discard'`, restore/abandon over a `RunPlan`, `planOf`
  for resume (the field test keeps `offerable: false`), the 4 h window, `modeState.thresholdMps`, and a
  persisted `discarding` flag so a failed delete is retried, never resurrected as a completed run.

## Commits (each green)

1. Domain: active time, free-run constants, `FixPolicy`, `deriveOpenRun`, the threshold aggregator.
2. Persistence: derived finalize, hard delete, the threshold reader, Health skip.
3. Engine types: the snapshot union, and the harness-only narrowing in `engine.test.ts`.
4. Engine seam: the mode owns its fold, cue suppression, skip and persisted fields; `RunPlan` in
   restore/abandon. Differential check against the pre-refactor engine.
5. `OpenMode`, discard, the limits, resume; wiring in `index.ts`; the re-fold
   callers. Differential check again.
6. Docs: ADR 0007, 0021 and 0026 amendments.

## Verification

- `bun test`, both typechecks, lint; both native fingerprints unchanged.
- `bun:sqlite` tests for the derived finalize and the hard delete (FKs on).
- Differential old-vs-new engine for plan runs after commits 4 and 5.
- Adversarial review (lensed, executing) before the PR.

## Review fixes (2026-09-29)

The lensed adversarial review found two Criticals, five Majors and a list of Minors; the owner chose
to fix all of them before the PR, and to close the engine gaps 3b would otherwise hit here.

- **Domain:** a trailing GPS silence is stopped time (`silentSince`, one rule for gaps and the end);
  bucket durations round from whole milliseconds; a log with no `end` ends at its last event.
- **Persistence:** `saveRun` derives a free run too (null when too short); a fallback log keeps its
  pauses.
- **Engine:** one `start(plan)`; the mode owns its start note and opaque `modeState`; `ModeFinal` is
  a union with a discard reason; downtime is a pause on resume; the event floor; `complete` only
  after the save kept the run; the discard guard; the live stopped clock follows the fold.
- **3b fields:** `gpsStale`, `endDiscards`, `elapsedAnchorMs`, `lastOutcome`, and a discard shows
  as ended at once.

## Review round 2 (2026-09-30)

Five lensed reviewers (engine races, live == saved, API and persistence, ADR compliance, comment
density) re-reviewed the fixes. Fixed:

- **Races:** an ending run captures its generation and row id first, so a `reset()`/`start()` can
  no longer skip a discard's delete, land an old record on a new row, speak `complete` mid-run or
  stop the next run's sensors; `abandon()` no longer resets a run started while it finished.
- **Clock skew:** a free run's fixes are stored at `min(fix time, wall clock)`.
- **The 30-minute limit counts only a measured stop** (owner decision): silence is stopped time
  but never ends or trims a run. One value in `openTrackStep`'s state serves the live limit and the
  finalize trim, which closes the sparse-fix, single-fix and lock-time mismatches.
- `endDiscards` applies the floor; the count-up anchor ignores a stale cached fix; `saveDerivedRun`
  keeps the live distance; comments, the `declineResumableRun` rename and the ADRs match the code.

For 3b: `abandon()` returns nothing, so the resume screen cannot tell that a declined free run was
deleted (under a minute) and would open a missing summary; `sessionTitle('free-run')` needs
`runTitle`.

Accepted, not fixed: a crash in the moment between asking for a discard and its mark landing
offers the run for resume; a failed delete followed by a new run in the same process orphans the
row (as a failed plan-run finalize already does); a free run past its measured-stop limit at its
last flush is offered for resume and then ends at once (reachability unproven). Outside this
stage: a late fix stamped before a segment boundary can repeat a plan run's segment cue.
