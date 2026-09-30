# Free run — stage 4: chart bands and the kilometre cue

Date: 2026-09-30
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §5.3, §5.4 · ADR:
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) §5, §7 (2026-09-30 stage-4 amendment),
[0009](../../adr/0009-cue-audio-tts-prerecorded-fallback.md) (2026-09-30 amendment) · follows 3c
(#87), precedes 5a/5b

## Goal

A free run's summary chart shows where the runner ran, walked and stopped, and a free run says each
kilometre aloud with the pace of the kilometre just run. Before this, the pace line dived into every
stop with nothing to say why (3b plan), and a free run was silent between Start and End.

## Owner decisions (2026-09-30)

- **Chart**: a thin run/walk strip along the x-axis, and a full-height hairline for each stop — not
  tinted full-height columns, and not stop ticks inside the strip.
- **Every stop** gets a hairline, the ~8 s crossing waits included, so the chart agrees with the
  bucket timeline below it.
- **Wording**: the spec's — "2 kilometres. 6 minutes 40 per kilometre."; a whole minute drops the
  seconds ("6 minutes per kilometre"), an unknown pace drops the pace ("2 kilometres.").

Defaults stated to the owner and kept: bands on free runs only; one announcement when a GPS gap
jumps past more than one kilometre; the chart's accessibility label mentions the stops; one PR
stacked on #87.

## Design

- **Pure** (`bun test`):
  - `cues.ts`: the `kilometre` id (milestone, fallback phrase "Kilometre."), `KilometreCueData`,
    `CueData`, `ModeCue`, `kilometrePhrase`, `cuePhrase`.
  - `run-profile.ts`: `foldRunProfile` → `{ points, spans }`, one fold; `toRunProfile` is its points.
  - `profile-bands.ts`: `toProfileBands(spans, segments)` merges consecutive spans of one kind and
    puts a stop at each stopped bucket (a silence at the end of the span before it); `bandsFor`
    returns null for a plan run.
  - `run-summary.ts`: `profileSpans` beside `profile`, null exactly when it is.
- **Engine**: `takeCues` returns `ModeCue[]`; `OpenMode.ingest` counts kilometres and the moving
  metres and active time since the last one (stopped, unknown and paused time left out) and
  captures the crossing; `takeCues` announces it once. `RunMode.caughtUp()` runs at the end of
  `rebuild()` so a resume never bursts. The engine logs `data` in the `cue` row and passes it on.
- **Cue service**: `announce(cue, data?)` on the port, the gating seam and both adapters
  (`Speech.speak(cuePhrase(cue, data))`); `CUE_HAPTIC.kilometre` is `bellToll`.
- **Hooks**: `useRunTrack` adds `bands`, memoized on the spans, the segment rows and the session
  key, apart from the summary so a live segment update never re-runs the fold.
- **Components**: `RunProfileChart` takes `bands` and draws Skia `Rect`s — the strip (run 4 dp,
  walk 2 dp) in the unclipped `renderOutside` layer, hung under the x-axis with the tick labels moved
  down to make room, and a 2 dp stop hairline inside the plot, before the lines, clamped into it
  (the auto x-domain starts half a bucket in). `RunProfileCard` passes them and reads the strip as
  distances in its label (`bandDistances`).
- **Copy**: the Settings milestone text on both platforms gains "each kilometre of a free run".

## Verification

- `bun test`, both typechecks, lint, `bunx expo export` for both platforms.
- A mutation check: without `caughtUp()` the engine's resume test fails.
- On device, the simulator's route engine (iOS) and `adb emu geo fix` stepping (Android) drive a
  free run of run → stand → walk → run past 1 km: the `cue` row carries `{ km: 1, paceSecPerKm }`,
  and the summary chart shows the strip and the hairline in light and dark. A plan run's chart is
  unchanged.
- Adversarial review before the PR.

## Verified on device (2026-09-30)

- **iOS 26.5 simulator**, the route engine driving run 700 m → stand 60 s → walk 200 m → run: one
  `cue` row `{ km: 1, paceSecPerKm: 446 }` (7:26 /km; the stop left out, the walk in). The dev
  client crashed mid-run on a Fast Refresh (`ExpoFabricView.injectInitializer` assertion, the same
  signature as a crash earlier that day, before this stage's edits); the crash-resume logged only
  `resuming`, so km 1 was not repeated. The summary drew the strip and one hairline at ~0.7 km in
  light and dark, and its label read "Running 1.21 km, walking 0.21 km, stopped 1 time."
- **Android emulator**, `adb emu geo fix` stepping the same shape: after a JS reload and a resume,
  `resuming` and then one `kilometre` row at km 1; the strip, three hairlines and the timeline agree
  in light and dark. A plan run's chart (Week 1 · Day 1, 0.84 km) has no strip, no hairlines and
  its tick labels in their old place.
- Settings shows the new milestone copy on both platforms.

Fixed on the way: the strip first sat inside the plot's bottom edge, where the pace line of every
walk lay on top of it; it now hangs under the axis.

## Found in review (2026-09-30)

Four lenses (the cue engine and the chart adversarially with harnesses, ADR compliance, comment
density). No Critical or Major. A 150-seed property harness (≈1,250 crossings, 71 crash/restore
cycles) found no skipped or repeated kilometre; a 400-run sweep through the real finalize put every
stop marker exactly at its bucket's start.

**Minor, fixed:** run and walk differed by hue alone (now 4 dp / 2 dp); the strip left a gap at a
stop between two kinds (now bridged); the label said nothing useful (now distances); no end-to-end
test from finalize to bands (added in `derived-finalize.test.ts`); an unreachable `announcedKm`
check (removed); a redundant branch in the engine's `announce`; three comments that restated code;
the resume test depended silently on one flush holding every point (now asserted); doc drift in the
ADR 0026 amendment (the multi-kilometre case), the checklist's K4 and ADR 0007 §5 (amended).

**Minor, accepted and documented:** a crossing lives one heartbeat before it is spoken, so a pause
inside that second defers it to the resume and an End drops it (ADR 0026 amendment).

**For the owner:** a GPS silence is stopped time (3a), so a tunnel or a slow first fix draws a
hairline and counts as a stop in the label, though the runner never stood.
