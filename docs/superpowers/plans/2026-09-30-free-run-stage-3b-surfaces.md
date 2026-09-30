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

## Found on device (2026-09-30)

Verified on the iOS 27 simulator and the Android emulator (API 37) through argent, with GPS driven
through run, walk and stop, in light and dark. Fixed on the way:

- The rolling pace showed while the label still read "Waiting for GPS" (before the first kind's
  8 s dwell).
- A discarded or too-short free run's idle `<Redirect href="/">` pushed a second copy of the tabs
  over the first; the run screen now dismisses back to them.

Noted, not changed: the Skia digits always draw two minute digits ("05:00"), as the plan countdown
already does; the pace chart's tail dives where a run slows into a stop until stage 4's bands; the
dev client can crash natively (`ExpoFabricView.injectInitializer`) when a bundle is opened from its
launcher menu after a relaunch — a cold `open-url` straight to Metro does not.

## Found in review (2026-09-30)

Four adversarial reviewers (stores and hooks, Maestro flows, ADR compliance, comment density), each
able to run code. Fixed:

- **Major:** on Android the resume sheet could be dismissed undecided (back, scrim, drag), leaving
  the resume gate shut and "New free run" disabled for the rest of the process; a dismissal now
  saves the run.
- **Major:** the resume sheet's no-summary exits still `replace('/')`d over the tabs; they share the
  run screen's dismissal (`leaveToTabs`).
- **Major:** the flows' first clock wait matched only 0:03–0:09, and the minute wait could match the
  Android status bar's clock; the minute wait now reads the clock `below` the run's own label.
- **Minor:** a resumed clock rolled up from 0:00; a discard froze the clock up to a second back; a
  live-run branch in the resume gate could open it while the launch check was still abandoning a
  stale run; the notice's few seconds started while the run modal still covered Plan.
- ADR 0006 amended (`fitToContents` start sheets, End under a minute, the resume sheet on Android,
  `leaveToTabs`); ADR 0026's gate wording corrected; comments trimmed per the audit;
  `RunPhaseHeader` requires a label for a free run's looks.
