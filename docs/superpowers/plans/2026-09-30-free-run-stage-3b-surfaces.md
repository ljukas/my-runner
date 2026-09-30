# Free run — stage 3b: the surfaces

Date: 2026-09-30
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §5, §8 · ADR:
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) · follows 3a (#83, merged)

## Goal

A runner can start, run, end and review a free run on both platforms. Everything below the screens
exists already (3a); this stage adds the entry point, the run screen, the End dialog, the not-saved
notice and the summary.

## Owner decisions (2026-09-30)

- The motion label looks like the plan run's phase header (symbol and label tinted with the bucket
  colour). "Waiting for GPS" and "Timer only" get a neutral grey and their own symbols, so a run
  without GPS never reads as stopped.
- The count-up clock reads `H:MM:SS` from an hour, `M:SS` before.
- Below the clock: distance and rolling pace ("—" when there is none), hidden without GPS.
- End: "End this run?" / "Save it to your Log, or discard it." with "Save Run" and a destructive
  "Discard"; iOS adds its own Cancel, Android shows Save Run and Cancel with Discard in the body.
  Under a minute, End skips the dialog.
- A run that leaves no summary shows a brief notice on the Plan tab: "Run discarded" or "Too short
  to save — under a minute".
- Health: free runs keep saving as plain workouts until stage 5 adds segments.
- Summary: Active Time, Moving Time, Distance, Run Pace, Walk Pace, Moving Pace and Elevation Gain;
  without measured distance only Active Time. The bucket timeline stays; per-bucket splits do not.
- E2E: `free-run.yaml` (save) and `free-run-discard.yaml`, both waiting out the minute, both lanes.
- Architecture: the clean design — pure helpers and shared hooks, so the platform forks stay thin.

## Design

- **Pure** (`bun test`): `domain/elapsed.ts` (count-up parts and formatting),
  `domain/free-run-view.ts` (the phase label, the metrics rule, the location line, the End
  dialog's copy), `domain/run-notice.ts` (the notice kinds and text), `freeRunStats` beside
  `bucketStats`.
- **Stores**: `resume-offer.ts` becomes observable (`checking` → `offered` → `clear`, fail-closed),
  so the entry is disabled while a resume is being decided; `services/run-notice/` holds the
  notice with a TTL, fed by the engine's idle `lastOutcome` (a module-scope bridge, deduped by
  snapshot identity) and by a declined resume whose run was deleted.
- **Hooks**: `useStartRun` (guard, JIT location ask, reset, start, replace — shared with the
  session sheet), `useFreeRunEntry`, `useEndRunDialog`, `useElapsedClock` (a JS timer on second
  boundaries; no `withTiming`, which Reduce Motion collapses).
- **Components**: `FreeRunView`; `RunTransport` takes one `end` variant (scripted or open) instead of
  `endsAsCompleted`, and shows Skip only for scripted runs; a shared `SkiaClockFace` behind the
  countdown and a new `SkiaElapsedClock`; `RunPhaseHeader` takes a label and a tone;
  `FreeRunStatGrid`; `RunNoticeRow` (iOS `Section`, Android `LazyColumn` item);
  `FreeRunHeaderButton` (Android, with an iOS stub). Routes: `free-run.tsx` (a root formSheet)
  and `(tabs)/(index)/_layout.android.tsx`.
- Under a minute, End calls the save path, which the mode turns into a `tooShort` discard; only the
  dialog's Discard says "Run discarded".

## Commits

1. Refactor: `useStartRun` shared by the session sheet; hoisted sheet options.
2. Pure helpers and their tests.
3. Observable resume gate and the notice channel.
4. Clock: `SkiaClockFace`, `SkiaElapsedClock`, `useElapsedClock`.
5. `RunTransport`'s `end` variant, `useEndRunDialog`, `RunPhaseHeader`'s label and tone.
6. `FreeRunView` behind `run.tsx`.
7. Entry: the sheet, the header buttons, the Plan notice.
8. The summary.
9. Maestro flows.
10. Docs: ADR 0026 amendment, spec §8 (the summary is anchored on Active Time: a Maestro run never
    moves, so Moving Pace never shows), AGENTS.md.

## Verification

- `bun test`, both typechecks, lint, `bunx expo export` for both platforms (the route forks).
- Plan runs unchanged: `run-controls`, `run-lock`, `run-abandon`, `complete-session` still pass;
  the scripted dialog's strings are untouched.
- On device: the iOS simulator and the Android emulator through argent, with a GPS drive through
  run, walk and stop; light and dark; Android screens scrolled to the bottom.
- Adversarial review before the PR.
