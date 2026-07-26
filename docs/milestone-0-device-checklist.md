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
