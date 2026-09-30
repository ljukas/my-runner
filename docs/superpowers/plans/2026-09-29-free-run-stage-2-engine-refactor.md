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
cue state and cue firing (transition, last run, halfway), exhaustion, finalize's status and segments,
and `endCountsAsCompleted`, its UI twin. `isTimelineExhausted` moves with it. `activeElapsedMs` moves
to `active-time.ts`, because active time stays the engine's (ADR 0026 §1). The engine re-exports both
UI and resume helpers, so their importers are unchanged.

`engine.ts` holds a `RunMode` instead of a `PlanSession`; `start(PlanSession)` and
`restore({ session })` keep their signatures. `RunSnapshot` gains `mode`, flat, which the engine
takes from `RunMode.kind`. `finalize` takes a `FinalizeOrigin` (`runner` | `abandon`) instead of a
scripted-only `promoteInCooldown` flag, and `complete` is spoken only for the runner's origin — the
same outcome for a plan run, and the rule stage 3's `OpenMode` needs, since it saves `completed` even
when abandoned.

## Decisions for the stage 3 plan

The design-fitness review found where this seam still stops short of `OpenMode`. Each is a decision
stage 3 records before implementation, not a stage-2 gap:

- **Cue tick.** `takeCues(events, elapsedS)` gets no distance and returns bare `CueId`s. The kilometre
  cue (stage 4) needs distance and typed data (`{ km, paceSecPerKm }`); the tick becomes a context
  object then.
- **Derived segmentation.** `finalize` is synchronous over the event log; an open run's buckets come
  from its points. `ModeFinal` and `CompletedRunRecord` gain `segmentation: 'scripted' | 'derived'`,
  and `save-run.ts` runs `rollupOpenTrack` plus the `segment_seq` rewrite for `'derived'`.
- **GPS ingest.** `openTrackStep` (smoother restart, bucket, rolling pace) is mode-specific but ingest
  stays in the engine. Stage 3 decides how the mode supplies its track step without the engine
  branching on the mode (the rejected flags design).
- **Mode-owned state.** `cueState()` is scripted-shaped and spread into `RunSnapshotState`; an open
  run writes neutral scripted fields (spec §3) or the state gains an optional `modeState`.
- **Sites still outside the mode:** `cuesSuppressed` (keyed on the field-test key), `skipSegment`'s
  guard, `captureReading`'s segment tag, `index.ts`'s direct `isTimelineExhausted` and resume
  freshness in `resumable.ts`, and one `modeFor` factory for the three `ScriptedMode` constructions.
- **`RunPlan`** arrives with `OpenMode`; the open variant would be dead code here.

## Verification

- `engine.test.ts` untouched (`git diff --stat` empty): its 115 tests pass, and all 164 in
  `run-engine/` (632 in all).
- Mutation check that the unchanged suite still guards the moved code (breaking each in `mode.ts`):
  halfway at the end — 2 failing tests; no cool-down promotion — 6; no last-run cue — 1; the cache
  ignoring skips — 6; elapsed uncapped — 1.
- **Adversarial review (three agents).** Differential testing ran the old and new engines through
  15,000 random scenarios (~595,000 operations, ~22,900 restores/abandons, extreme sessions included)
  and 1,296 cue-state restores: zero divergence, with a mutant engine caught in 134 of 200 runs. After
  the seam fixes above, a further 6,000 scenarios (238,254 operations, 9,037 restores/abandons) and the
  cue-state suite: zero divergence again. The design-fitness review's findings are the section above.
- Both typechecks, lint, both native fingerprints unchanged.
- E2E: the `e2e-ios` and `e2e-android` checks on the PR (they run on stacked PRs — no base filter).
  Not run locally: three simulators were booted, and `refresh.sh` needs exactly one.
