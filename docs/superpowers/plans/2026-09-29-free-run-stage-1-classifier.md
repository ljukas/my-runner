# Free run — stage 1: the classifier

Date: 2026-09-29
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §4, §7 stage 1 ·
ADR: [0026](../../adr/0026-free-run-open-mode-motion-buckets.md) §3, §5

## Goal

Pure domain code that turns a GPS fix stream into run/walk/stopped buckets, learns the run/walk
threshold from a runner's plan runs, and computes free-run pace — plus a replay harness that
reproduces the spec's §4.4 numbers from the field captures. **No app change**: nothing here is
imported by `src/app/`, `src/services/` or `src/components/`, so neither native fingerprint moves and
the app behaves exactly as on `main`.

## Tasks (test first, each)

1. **`quantile(values, p)`** in `src/domain/math.ts` — linear interpolation between order statistics
   (the harness and the learner must agree with the spec's measurement, which used this definition).
2. **`SmoothStep.smoothedSpeedMps`** in `src/domain/geo.ts` — the Kalman speed after an accepted
   step; `null` on the seed fix, a restart, a non-monotonic timestamp and a velocity-gate rejection.
   Additive: every existing `geo.test.ts` case stays unchanged.
3. **`motionStep`** in `src/domain/run-motion.ts` — spec §4.3: start state, targets (0.5 / 0.8 m/s
   stopped band, single threshold `T`), direct transitions, 8 s dwell with a 70 % majority,
   retargeting without resetting the start, backdated boundary, null speed holds, a resumed sample
   clears the candidate.
4. **`largestRemainder(values, total)`** — integer durations that sum exactly to `total`.
5. **`openTrackStep` + `rollupOpenTrack(fixes, options)`** — the per-fix step the live engine will
   call, and its fold, so live and batch cannot diverge (added after the ADR-compliance review): the
   smoother restarts at the first fix after a pause; buckets tile `startMs`→`endMs`; a GPS gap longer than
   `MAX_GAP_S` of active time is stopped; each committed delta lands in the bucket of its end fix;
   active seconds exclude pauses.
6. **`learnThreshold(samples)`** + **`labelledSpeeds(fixes, kindBySeq)`** — spec §4.4: walk p90 and
   run p10 over walk/run intervals only, first 10 s of each interval dropped, 60-sample floor, 2.1 m/s
   fallback.
7. **`bucketStats(segments)`** in `src/domain/run-stats.ts` — run, walk and moving pace as distance
   sums over time sums; stopped distance excluded; nulls when a kind has no distance or time.
8. **Harness** `scripts/replay-free-run-motion.ts` — parses exports through a parser shared with
   `scripts/analyze-field-capture.ts` (moved to `scripts/lib/`), scores every plan run with a
   threshold learned from the runs before it, and prints the §4.4 table. Aggregates only — no
   coordinate is ever printed (the export's first and last fix are the runner's home).

Also: flip ADR 0026's status to `Accepted` (it merged as `Proposed`).

## Verification

- `bun test`, `bun run typecheck`, `bun run typecheck:android`, `bun run lint`.
- The harness over the 12 captures reproduces §4.4 (mean held-out agreement 97.5 %, run pace within
  2 % on 7 of 8). A divergence is a finding to explain, not to tune away.
- `bunx expo-updates fingerprint:generate --platform ios | jq -r .hash` equal before and after.

## Review

Before the PR: a comment-density audit (3 comments trimmed), an ADR-compliance review (two
violations — the confirmation rule, now pinned by a test and stated in the spec; and live/batch
logic that only the fold had, now `openTrackStep` — plus missing spec §8 cases, now noisy-track
tests) and a correctness review (no high-confidence bugs; the harness's NaN mean fixed). Seven rules
were mutation-checked — reverting each fails its test: the majority rule, the reverted-change rule,
the 0.8 m/s stopped exit, pause clearing the candidate, the smoother restart on resume, the
`[startMs, endMs]` clamp and largest-remainder rounding.

## Open items carried to stage 3

- Every other re-fold of a free run's points must restart at resumes (spec §4.3).
- The spec asks for one outdoor capture with a stop at a crossing and a mid-run pause before the
  constants are frozen. Until it exists, the constants stay as measured and are marked provisional in
  `run-motion.ts`.
