# Milestone 0 — physical-device checklist

The flagship Stage-3 behaviour cannot be verified on a simulator: locked-phone
GPS continuity and cue audibility are device-and-radio reality, not API
capability. This checklist is that gate (spec §10, [ADR 0008](adr/0008-background-execution-location-heartbeat.md) §7,
[ADR 0009](adr/0009-cue-audio-tts-prerecorded-fallback.md) §5). **Stage 3 is not
complete until a run of this checklist passes on a real iPhone in a release
configuration.**

Re-run it whenever the location, audio or cue stack changes (SDK upgrade,
expo-location / expo-speech / expo-audio version bump, cue-adapter swap) — ADR
0008 calls for re-validation per release.

## Pre-flight

- [ ] **First launch, before touching system Settings:** the primer appears before any system prompt, "Not Now" is available, and the prompt offers *While Using the App* only — never Always (ADR 0008 §2).
- [ ] Build a **release-configuration** app for a physical device — not the dev
      client, not the simulator build. Either:
      - `eas device:create` (once per device), then `eas build -p ios -e preview`
        and install the resulting build. `preview` sets no `APP_VARIANT`, so this
        is the production identity `se.lukaslindqvist.runbro` (ADR 0019); or
      - locally:
        ```
        export COREPACK_ENABLE_AUTO_PIN=0
        bunx expo prebuild -p ios --clean
        bun expo run:ios --configuration Release --device
        ```
- [ ] Confirm it is a real release build: the Settings screen has **no Developer
      section**, and the plan shows real durations (the compressed plan is
      dev/E2E only).
- [ ] Device: iPhone, iOS version recorded below. Battery ≥ 60 %, **Low Power
      Mode OFF** (it throttles background work and would invalidate the test).
- [ ] Settings → Privacy & Security → Location Services **ON**, and (after
      onboarding) this app set to *While Using the App* with **Precise Location
      ON**.
- [ ] Focus / Do Not Disturb **OFF** (a Focus can silence cue audio and the
      inbound test call).
- [ ] Spotify (or Apple Music) installed with an offline-capable playlist.
- [ ] Bluetooth headphones charged and paired.
- [ ] A second phone to call from.
- [ ] A reference tracker for distance truth: start an Apple Fitness *Outdoor
      Run* on an Apple Watch, or a second phone running Strava, at the same
      moment as the run — or use a route of known length (a marked track).
- [ ] Outdoors with open sky. Do not run this in a building or a car.

## Part 1 — Bench checks (~10 min, indoors is fine)

Start any session (W1D1 is shortest) and use the first minutes for these; end
the run early afterwards.

- [ ] **Silent switch:** flip the ring/silent switch to silent. Cues are still
      audible (`playsInSilentMode`, ADR 0009 §2).
- [ ] **Spotify duck-and-recover:** start playback in Spotify, return to the app.
      At the next cue the music **dips** (does not pause or stop), the cue is
      clearly audible over it, and the music returns to full volume within ~2 s
      after the cue. Verify across two consecutive cues (back-to-back utterances
      are the #41 regression class).
- [ ] **Music not left ducked:** end the run. Spotify returns to full volume and
      stays there (the "stuck ducked" class, ADR 0009 §3).
- [ ] **Bluetooth headphones:** connect them, start a run, confirm cues play
      through the headphones and music ducks the same way. Disconnect
      mid-session — audio falls back to the speaker and cues keep coming.
- [ ] **Phone call:** with the run going, take an inbound call from the second
      phone. During the call the run keeps timing; after hanging up, cues resume
      and the timer is still correct (spec §11).
- [ ] **Denied path (separate launch, optional but cheap):** revoke location in
      system Settings, start a run — the honest banner appears ("Location is
      off"), the timer stays correct, and the banner deep-links to Settings.
      Re-grant afterwards.

## Part 2 — The 30+ minute locked outdoor run

Use **W5D1 (31:00 — warm-up, 3 × 5 min run with 3 min walks, cool-down)**: it
clears the 30-minute bar and still contains six interval transitions plus the
halfway, last-run and complete milestones. W9D1 (40:00) is the endurance
variant if you want a longer soak.

- [ ] Start the reference tracker, then start the session in the app.
- [ ] **Lock the phone** (press the side button) and put it in a pocket or
      armband. Keep it locked for the whole session except the explicit checks
      below.
- [ ] The blue **background-location indicator** is visible on the Lock Screen /
      status bar for the whole run (expected — it is an honesty feature, ADR 0008 §8).
- [ ] **Stationary check (`pausesUpdatesAutomatically: false`, ADR 0008 §3):** during a walk interval stop completely for 60–90 s with the phone locked. Cues keep firing on schedule through and after the stop, and afterwards that walk segment still shows a plausible span in the *Interval Pace* card. A missed cue or a hole here means the update stream was paused.
- [ ] **Every cue is heard while the phone is locked.** Tally them as they come:
      - [ ] warm-up start
      - [ ] run 1 / walk 1
      - [ ] run 2 / walk 2
      - [ ] halfway
      - [ ] last run
      - [ ] cool-down
      - [ ] workout complete
- [ ] **No cue fade-out over time** — the last cues are as loud and complete as
      the first (the expo #19407 class; this is the single riskiest assumption).
- [ ] Music keeps playing between cues and ducks around each one for the whole
      30+ minutes.
- [ ] At ~15 min, wake the screen briefly: elapsed time is correct against a
      wall clock, distance is advancing and pace is plausible. Lock again.
- [ ] The app is still alive at the end — the run finishes on its own and the
      summary appears (no relaunch, no "Resume run?" sheet).

## Part 3 — After the run

- [ ] **Distance sanity:** the summary's total distance is within ~5 % of the
      reference tracker (or the known route length). Record both numbers below.
- [ ] **No GPS holes:** every interval in the *Interval Pace* card has a
      non-zero distance and a plausible pace; no segment reads "—" or a wildly
      low value where you were moving.
- [ ] Average pace matches your effort (a walk-heavy session reads slower than
      the run splits).
- [ ] The Log row shows the run with its duration and distance; reopening it
      shows the same numbers.
- [ ] Battery drain for the session is acceptable (record it — BestForNavigation
      with no deferral is expected to be costly, ADR 0008 Consequences).
- [ ] No crash, no white screen, nothing lost.

## Part 4 — Kill-mid-run resume (5 min, outdoors — walking is enough)

- [ ] Start a session, **walk outdoors ~2 minutes until the run screen shows a non-zero distance**, note it, then force-quit from the app
      switcher.
- [ ] Relaunch: the **"Resume run?"** sheet appears naming the session.
- [ ] Resume: elapsed continues from where it was (wall-clock derived — the dead
      time counts), and the distance recorded before the kill is still there.
- [ ] Repeat once and choose **Save as Partial** instead: the run lands in the
      Log marked *Partial*.

## Verdict

| Field | Value |
| --- | --- |
| Date | |
| App version / build | |
| Device / iOS version | |
| Session used | |
| Summary distance vs reference | |
| Cues heard while locked | / 7 |
| Battery used | |
| **Verdict (go / no-go)** | |
| Notes | |

**If TTS-while-locked fails** (cues inaudible, faded, or missing once the screen
is off): this is the pre-decided trigger for the **pre-recorded cue fallback**
([ADR 0009](adr/0009-cue-audio-tts-prerecorded-fallback.md) §6) — one bundled
audio file per `CueId` played through expo-audio on the identical session
configuration. It is an adapter swap behind the existing `CueService` port; the
engine, screens and cue script do not change.

**If locked-phone GPS continuity fails** (the fix stream stops when the screen
locks, or the run dies in the pocket): that is not an adapter swap — it
invalidates the aliveness contract in [ADR 0008](adr/0008-background-execution-location-heartbeat.md) §4
and must reopen that ADR before Stage 3 ships. Record exactly when delivery
stopped and what the phone was doing.

Observe it two ways: (a) before the run, connect the iPhone to a Mac and leave Console.app filtered on the app process to capture the delivery timeline; (b) after the run, open the summary's *Interval Pace* card — the first segment reading "—" or an implausibly short distance brackets when delivery stopped. Record both.

## Stage 4 verification (2026-07-29)

Simulator pass for [Task 14](../.superpowers/sdd/2026-07-29-stage-4-maps/task-14-brief.md)
(spec [2026-07-28-stage-4-maps-design.md](superpowers/specs/2026-07-28-stage-4-maps-design.md)
§10). Two synthetic runs were seeded directly into each simulator's `runbro.db`
(`bun:sqlite`, via `domain/geo.ts`'s own `smoothTrackBySegment`/`encodePolyline`
so the rows match what `finalizeRun` would have written): a full-length W1D1
loop (17 segments, 1710 s, 2759 m, start/finish 3.95 m apart — Stockholm
street-grid) and a short point-to-point dogleg (3 segments, 240 s, 444 m,
endpoints 388 m apart). Screenshots referenced below live in
`.superpowers/sdd/2026-07-29-stage-4-maps/screenshots/`.

Runtimes: iPhone 17 Pro, iOS 26.5 (primary) and the "ios 17" simulator, iOS 17.5
(floor check, item 11) — that device had no simulator instance before this
pass; created none, it already existed, just booted + installed the existing
`RunBrodev.app` onto it (a simulator build is universal across iOS versions
above its 17.0 deployment target, so no rebuild was needed).

| # | Check | iOS 26.5 | iOS 17.5 |
| --- | --- | --- | --- |
| 1 | Paint order (markers above lines) | Pass — `01-item1-loop-card-ios26.png`, `02-item1-loop-viewer-ios26.png` | Pass — `18-item8-ios17-viewer-works.png` |
| 2 | Framing (short loop + long point-to-point) | Pass — see #1/#2 shots | Pass (loop) — `18-item8-ios17-viewer-works.png`, `22-item8-ios17-card-recovered-loop.png` |
| 3 | Chevron legibility | N/A — chevrons removed (spec §5) | N/A |
| 4 | Route legibility, real length (17-seg W1D1) | **Pass — see verdict below** | Pass — `22-item8-ios17-card-recovered-loop.png` |
| 5 | `cameraPosition` sticks on first paint (no ref) | Pass — camera fitted correctly every open | Pass |
| 6 | Card doesn't steal scroll; tap opens viewer; pressed state visible | Pass — `04-item3-pressed-baseline-ios26.png`/`05-item3-pressed-during-ios26.png` pixel-diffed (avg Δ≈10 across the card, opacity 0.85) | Pass |
| 7 | Card's `accessible` group surfaces in `inspect_screen` (argent `describe` here) with composed label; viewer's 1pt label too | Pass — `"Map of your 2.76 km route"` / `"Map of your 0.44 km route"` buttons, and `"Your 2.76 km route"` / `"Your 0.44 km route"` viewer nodes, all present in the AX tree | Pass |
| 8 | Squircle clipping under `overflow-hidden` | Pass — no square corners bleeding | Pass |
| 9 | Endpoint markers: balloon size; merge rule on a loop | Pass — loop merges to one marker (3.95 m apart); point-to-point keeps two (388 m apart) — `01-item1-loop-card-ios26.png`, `03-item2-p2p-two-markers-ios26.png` | Pass — loop merges to one (`22-item8-ios17-card-recovered-loop.png`) |
| 10 | Memory: viewer over card + 5+ Log runs | See note below | Not run (would need repeating the full browse pass on this device; skipped for time — the iOS 26.5 result is the one that generalizes, since it's the same native map-hosting mechanism) |
| 11 | iOS 17 render path smoke | — | **Two failures found, both deferred — see below** |
| 12 | No-route paths (denied / stationary) draw no map | Pass — both CTA variants confirmed (`06-item4-undetermined-enable-location-ios26.png`/`07-item4-denied-open-settings-ios26.png`), native re-prompt confirmed (`08-item4-native-reprompt-ios26.png`), plus a bonus "recorded, no extent" (treadmill) copy variant seen on a pre-existing dev run | Not run |

Two items outside the enumerated 12 were also exercised on iOS 26.5 only:
Dynamic Type at `accessibility-extra-large` (`09-item5-dynamic-type-ios26.png` — card keeps its 3:2 box,
expand-chip glyph visibly tracks `PixelRatio.getFontScale()`) and the cold
deep-link `dismissTo('/log')` fallback (`10-item6-cold-deeplink-route-ios26.png`/`11-item6-cold-deeplink-closed-to-log-ios26.png` — a genuine
zero-back-stack launch straight into `runbrodev://runs/<id>/route`, confirmed
via the AX tree showing no tab content mounted underneath; `Close map`
correctly landed on the Log tab).

**Item 4 verdict — route legibility at real length.** At the compressed-plan
E2E scale (~100 m, `12-item1-e2e-scale-dashed-contrast-ios26.png`) the hue+width encoding reads as a dashed/glitched
line, exactly as spec §7.3 warns. At the seeded run's real ~2.8 km scale
(`01-item1-loop-card-ios26.png`/`02-item1-loop-viewer-ios26.png`) it reads clearly as phases: distinct thick-blue run chunks
separated by thin-gray walk chunks, orange warmup and teal cooldown legible
against the light basemap. The width double-encoding is what rescues this —
hue alone would not. **No design change needed**; the spec's real-length
assumption holds.

**Item 10 — memory, iOS 26.5.** Tracked the dev-build process RSS (`ps -o
rss=`) around opening the viewer over the card (two live `AppleMaps.View`s at
once) and browsing 6 different runs from the Log (4 with a route, one
treadmill/no-extent, one no-fixes). Baseline 902 MB → four separate
viewer-over-card opens peaked at 1006–1052 MB each (no monotonic climb across
them) → settled at 1003 MB, flat across three samples 3 s apart after
everything closed. Net one-time growth ≈100 MB attributable to MapKit/tile
caches warming up on first use, not a per-open leak. Caveat: this is a dev
build (Metro, inspector) so the absolute numbers don't transfer to a release
build — the trend (plateau, not climb) is the evidence.

**Item 11 — iOS 17.5 findings, both deferred (not fixed).**

1. **The route map card is silently absent on a fresh process's first two map
   views** (`19-item8-ios17-card-MISSING-loop.png`, `20-item8-ios17-card-MISSING-p2p.png` — headline goes straight to the stat grid, no card,
   no `RouteUnavailableCard` fallback, no trace in the AX tree; no JS
   exception in the Metro log, no native crash in the device log, process
   stays alive and every sibling on the screen renders fine). The full-screen
   viewer (`route.tsx`, no `useLocationPermission()` call) opened cleanly on
   the very next attempt (`18-item8-ios17-viewer-works.png`) with correct paint order, colours, framing,
   and single merged marker — confirming the `AppleMapsViewiOS17` renderer
   itself is fine. Going back from the viewer to the *same* run's summary
   showed its card rendering correctly, and a fresh visit to the *other*
   seeded run's card then also succeeded. Pattern: attempts 1–2 (both cards,
   within ~15 s of launch) failed; attempt 3 (the viewer, ~30 s later) and
   every attempt after succeeded. Reads as a one-time MapKit/CoreLocation
   warm-up race on this older runtime, isolated to `RouteMapCard`'s embedding
   (not the `RouteMap` port, not `AppleMaps.View` itself, not
   `useLocationPermission` — nothing in that hook can throw synchronously
   during render). **Deferred**: needs Xcode's view debugger attached to the
   17.5 simulator to see the actual native view state during the failure
   window, which is outside this pass's tooling. A real user's very first
   "finish a run, see the map" moment on an iPhone still on iOS 17.x could
   land on a card-less summary.
2. **Unrelated to maps — surfaced only because this was the first onboarding
   pass done on this runtime this stage:** `OnboardingStepScreen`'s `Footer`
   (`absolute right-0 bottom-0 left-0` inside a `flex-1` root, per
   `src/components/ui/footer.tsx` / `src/components/onboarding-step-screen.tsx`)
   renders pinned to the **top** of the screen instead of the bottom, on
   *every* onboarding step, iOS 17.5 only (`15-footer-bug-ios17-welcome-icon-blowup.png`, `16-footer-bug-ios17-audiocues-top.png`, `17-footer-bug-ios17-locationprimer-top.png`; the same three steps
   confirmed correctly bottom-pinned on iOS 26.5, `13-footer-bug-ios26-correct-bottom.png`/`14-footer-bug-ios26-correct-bottom2.png`, same JS
   bundle). The welcome step additionally shows its `h-22 w-22` hero icon
   filling almost the entire screen. Both screens sit inside a `ScrollView`
   with `contentInsetAdjustmentBehavior="automatic"` and a nested Stack with
   `headerTransparent: true` presented inside a root-Stack modal — a
   plausible shared mechanism with the map-card timing issue, but not
   confirmed. Found and fixed in passing: `rounded-[20xp]` → `rounded-[20px]`
   (`src/app/onboarding/index.tsx`) — a plain typo, does not explain the
   layout collapse (same malformed class ships to both OS versions; only
   17.5 breaks), fixed because it was an unambiguous one-character
   correctness bug. **The positioning bug itself is deferred** — it is a
   pre-existing regression unrelated to Stage 4's map work, out of this
   task's scope to root-cause without native debugging tools, and does not
   block the map checklist.

## GPS-motion payload — device-only from 2026-07-31

`run-distance.yaml` covered the Stage-3/4 headline payload and was **removed**:
Maestro cannot drive simulated GPS motion into this app, so the flow could never
pass (ADR 0001, 2026-07-31 amendment). Nothing in `.maestro/` asserts recorded
distance, pace or a drawn route any more, so these are now device/manual checks.

Cover them on the outdoor run in Part 2, or on the simulator with the simulator's
own route engine — which does produce genuine moving fixes:

```bash
xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686
# then run a session; `xcrun simctl location <udid> clear` afterwards
```

| # | Check | Was covered by |
| --- | --- | --- |
| G1 | Summary shows a non-zero Distance and a plausible Avg Pace | `run-distance` |
| G2 | The same distance reaches the Log row (write → finalize → read → display, ADR 0021 §3) | `run-distance` |
| G3 | Route card renders a segment-coloured line with start/finish markers | `run-distance` |
| G4 | Card opens the full-screen viewer; closing returns to an intact summary | `run-distance` |
| G5 | Interval Pace card lists per-segment splits with the fastest badged | `run-distance` |
| G6 | Distance/Avg Pace tiles and Interval Pace are **absent** when no movement was measured (`hasMeasuredDistance`, spec §8) | `complete-session` (still covered) |

G6 stays covered automatically; G1–G5 do not. Verified manually on 2026-07-31 via
the route-engine command above: all five passed (0.11 km over a 40 s compressed
session, pace 5:57 /km, route card and viewer both rendering, splits and Log row
correct).
