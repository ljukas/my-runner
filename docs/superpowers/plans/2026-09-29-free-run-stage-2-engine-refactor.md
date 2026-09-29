# Free run — stage 2: the engine refactor

Date: 2026-09-29
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §3, §7 stage 2 ·
ADR: [0026](../../adr/0026-free-run-open-mode-motion-buckets.md) §1 · stacked on stage 1 (#78)

## Goal

Move every plan-relative rule of `RunEngine` behind a `RunMode`, with `ScriptedMode` holding today's
code verbatim, so stage 3 adds `OpenMode` without touching plan-run logic. **No behaviour change**,
proven by `engine.test.ts` passing with no line of it changed.

## Scope

`src/services/run-engine/mode.ts` (new): `RunMode` and `ScriptedMode`. `ScriptedMode` owns the
timeline and its skip-keyed cache, position and done, the capped elapsed and the countdown fields,
cue state and cue firing (transition, last run, halfway), exhaustion, and finalize's status and
segments. `activeElapsedMs` and `isTimelineExhausted` move with it; the engine re-exports the latter,
so `index.ts` and the tests import it unchanged.

`engine.ts` holds a `RunMode` instead of a `PlanSession`; `start(PlanSession)` and
`restore({ session })` keep their signatures. `RunSnapshot` gains `mode: 'scripted'`, flat.

Deferred to stage 3, deliberately: `RunPlan` and `OpenMode`; `captureReading`'s segment tag (still
the snapshot's `segmentIndex`); resume freshness (`resumable.ts`) and `planOf`; `endCountsAsCompleted`,
which stays the UI's rule for the scripted snapshot.

## Verification

- `engine.test.ts` untouched (`git diff --stat` empty) and green: 164 engine tests, 623 in all.
- Mutation check that the unchanged suite still guards the moved code: halfway at the end (2 fail),
  no cool-down promotion (6), no last-run cue (1), the cache ignoring skips (6), elapsed uncapped (1).
- Both typechecks, lint, both native fingerprints unchanged.
- E2E: the `e2e-ios` and `e2e-android` checks on the PR (they run on stacked PRs — no base filter).
  Not run locally: three simulators were booted, and `refresh.sh` needs exactly one.
