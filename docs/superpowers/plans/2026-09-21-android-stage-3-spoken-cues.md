# Android Stage 3 — Spoken Cues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **handoff**: stage 2 is built on `ll/android-stage-2` (stacked on PR #61); branch this stage as `ll/android-stage-3` on top of it. Read [ADR 0025](../../adr/0025-android-staged-migration.md), [ADR 0009](../../adr/0009-cue-audio-tts-prerecorded-fallback.md), the [stage 2 plan](2026-09-21-android-stage-2-location-heartbeat.md) (its "As built" section is the list of emulator traps) and the `android-stage-2` memory first.

**Goal:** An Android run is coached by voice: "Start running", "Start walking" and the milestones are spoken over the runner's music, the music dips only around each utterance, cues keep speaking with the screen off (stage 2's heartbeat already makes the engine fire them on time while backgrounded — measured 0.1–0.2 s late), the audio-cues onboarding step returns, and Android Settings says "Coaching" like iOS does — with iOS untouched.

**Architecture:** Replace the haptic-only `src/services/cue-service/adapter.android.ts` with a speech-plus-haptic adapter behind the unchanged `CueService` port; the composition seam (`cue-service/index.ts`, interval/milestone gating), `release-scheduler.ts`, `cue-haptics.ts`, `domain/cues.ts` and the engine are untouched. Speech is `expo-speech` (Android `TextToSpeech`, already installed, queues utterances until the engine is ready). **The one thing the iOS adapter's shape cannot give Android is ducking** — see Decision below. Governing ADRs: 0003, 0009 (amend for Android mechanics), 0013, 0016, 0019, 0025.

**Tech Stack:** Expo SDK 57 · `expo-speech` 57.0.1 · `expo-audio` 57.0.3 · Expo Modules API (Kotlin) for the audio-focus connector · argent 0.25.2 on `emulator-5554` (Pixel 9 Pro API 36, Google TTS `com.google.android.tts` installed) · Metro on 8087

## Decided (2026-09-21, Lukas): Android ducks via a local audio-focus Expo module (option A)

Verified in source (2026-09-21, `expo-audio` 57.0.3 `AudioModule.kt`, `expo-speech` 57.0.1 `SpeechModule.kt`):

- `expo-speech` on Android never requests audio focus; `useApplicationAudioSession` is iOS-only.
- `expo-audio` on Android requests focus (`AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK` under `interruptionMode: 'duckOthers'`) **only when one of its players starts playing**. `setIsAudioActiveAsync(true)` requests nothing; `setIsAudioActiveAsync(false)` does abandon focus. So the iOS adapter's activate-speak-deactivate pattern speaks fine on Android but ducks nothing.

Options considered; **A is the decision**, B and C are the recorded alternatives:

- **A — a tightly scoped local Expo module for audio focus (decided).** `modules/audio-focus/` (Expo Modules API, Kotlin, ~40 lines, no config plugin): `request()` → `AudioManager.requestAudioFocus(AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK, USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)`, `abandon()`. The Android adapter then mirrors `adapter.ios.ts` line for line: `begin()` → `request()` → `Speech.speak(...)`; `end()` via the existing release scheduler → `abandon()` after the last in-flight utterance. Keeps TTS-first (ADR 0009's reason: no asset pipeline), keeps one release-scheduler contract on both platforms, and follows the ADR 0011 precedent of owning a small connector rather than fighting a library. First native code in the repo; the Expo Modules API is first-party tooling. Fingerprint changes (a native stage anyway).
- **B — ADR 0009 §6's pre-recorded fallback adapter, Android-only.** One bundled clip per `CueId` played through `expo-audio`, whose player requests focus for free. Zero native code, deterministic voice. Costs: an asset pipeline for ten English clips, a different voice from iOS, and an unverified risk — expo-audio's Android playback runs through its media session service, and starting it from a backgrounded process (screen off, kept alive only by the location service) may hit Android 14+'s background foreground-service-start restriction. Needs a spike before committing.
- **C — no ducking on Android in v1.** TTS speaks over the music at full volume. Honest, zero-risk, and what the runner hears is worse than iOS. Acceptable as the degraded outcome if A is rejected and B's spike fails; record it in ADR 0009 and the stage table.

Tasks 1 and 2 below are written for A. B stays the pre-approved fallback if A fails on a device (ADR 0009 §6 already sanctions the swap); C is the honest degraded outcome only if both fail — either would be its own dated ADR 0009 amendment.

**Second decision, smaller — vibration with the screen off.** Stage 2 left `cue-service/adapter.android.ts` foreground-gated ("a vibration the runner cannot place"). Decided: keep the gate, matching ADR 0009 §7 exactly (haptics are an accent, never load-bearing, foreground-only on both platforms) — one rule, no per-platform explanation in Settings. Revisit only on field feedback.

## Global Constraints

- **Read https://docs.expo.dev/versions/v57.0.0/sdk/speech/ and /sdk/audio/ first**; verify options against `node_modules/expo-speech/src/Speech.types.ts` and `node_modules/expo-audio/src/Audio.types.ts`. Context7 is fine for both. For Android semantics read the Kotlin: `SpeechModule.kt` (utterance queue until `isTextToSpeechReady`, `onDone`/`onStop`/`onError` all fire) and `AudioModule.kt` (`requestAudioFocus`/`releaseAudioFocus` call sites).
- **iOS must not change.** `adapter.ios.ts`, `release-scheduler.ts`, `index.ts`, `port.ts` untouched. A shared screen may change only by a one-line `Platform.select` where the copy is platform-false (the audio-cues primer's "silent switch" / "Apple Music" sentence).
- **Set the speech language explicitly on Android** (`language: 'en-US'`): the phrases are English, `SpeechModule.speakOut` falls back to `Locale.getDefault()`, and a Swedish-locale device would read English text with a Swedish voice. iOS is not touched by this (its adapter passes no language; leave it).
- **Stage-2 emulator traps still apply**: native change ⇒ `bun run prebuild:dev:android` then `cd android && APP_VARIANT=development ./gradlew :app:installDebug`; the debug APK needs ~2× 340 MB free on `/data` (delete `/data/local/tmp/app-debug.apk` after a failed install, uninstall before reinstall); after a force-stop, `launch-app` by package before `open-url`; the fresh-install dev-menu sheet sits where the primer's button is; `debugger-connect` on a shared Metro keeps picking the iPhone — use `run_log` rows via `run-as` + `sqlite3` for evidence.
- **argent boots emulators muted** (`boot-device` `sound: false` default). Audibility on the emulator needs `boot-device` with `sound: true` and `force: true` once (a cold boot). Objective evidence does not need sound: `adb shell dumpsys audio | grep -A8 'Audio Focus stack'` shows the focus request and its abandon; logcat `SpeechModule`/`TextToSpeech` lines show utterance start/done; `run_log` `cue` rows show engine timing.
- **Comments WHY-only; architecture in ADR 0009/0025.** Objective gate per task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`. Metro on **8087**; `APP_VARIANT=development`; never touch `bun.lock`/`CHANGELOG.md`/`version`; `export COREPACK_ENABLE_AUTO_PIN=0`.

## Task Order and Why

The focus module first (if A) because it is the one native change and forces the Gradle rebuild. The adapter next, verified by logcat and the focus stack before any UI. Then the stage-1 stubs revert (onboarding step, Settings copy). Then the screen-off speech test riding stage 2's heartbeat recipe. Docs last.

---

### Task 1: audio-focus connector
**Files:** New `modules/audio-focus/` (`expo-module.config.json`, `android/build.gradle`, `android/src/main/java/expo/modules/audiofocus/AudioFocusModule.kt`, `index.ts`, `src/AudioFocusModule.ts` with a `.ios.ts`/`.web` no-op so the shared import resolves everywhere — expo-router evaluates every platform's routes in both bundles, and the module is imported only from `adapter.android.ts`, but the local-module autolinking still needs an iOS stub to build).
- [ ] `expo-module.config.json` with `platforms: ["android"]`; module exposes `request(): boolean` (focus granted) and `abandon(): void`; `AudioFocusRequest.Builder(AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)` with `AudioAttributes` `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` / `CONTENT_TYPE_SPEECH`; idempotent both ways; no listener beyond logging loss.
- [ ] Confirm autolinking picks it up (`bunx expo-modules-autolinking search` lists it; `bun run prebuild:dev:android`; Gradle build). Record the iOS fingerprint moving (expected; native stage) — and that the iOS Maestro suite is still the owner's gate.
- [ ] `bun run typecheck` (iOS project) must not see Kotlin-only types: the TS wrapper is a plain `requireNativeModule` behind `Platform.OS === 'android'`, or lives only in `.android.ts`.

### Task 2: the real `adapter.android.ts`
**Files:** Rewrite `src/services/cue-service/adapter.android.ts`; read `adapter.ios.ts` as the template.
- [ ] Same shape as iOS: `createReleaseScheduler({ debounceMs: RELEASE_DEBOUNCE_MS, release: abandonFocus })`; `prepare()` resets the scheduler and calls `setAudioModeAsync({ playsInSilentMode: true, interruptionMode: 'duckOthers', shouldPlayInBackground: true })` (harmless on Android; keeps one config table) — **and warms the TTS engine** so the warm-up cue is not the utterance that pays the engine-init delay (`Speech.getAvailableVoicesAsync()` or `Speech.isSpeakingAsync()` both instantiate `TextToSpeech`; verify in `SpeechModule.kt` which one creates it).
- [ ] `announce(cue)`: `releaseScheduler.begin()` → `AudioFocus.request()` → `Speech.speak(CUE_PHRASE[cue], { language: 'en-US', onDone/onError/onStopped: () => releaseScheduler.end() })`; haptic accent only while `AppState.currentState === 'active'` (Decision 2). Warnings non-fatal, identical `warn()` helper.
- [ ] `release()`: `releaseScheduler.reset()`, `Speech.stop()`, then abandon focus only if `isIdle()` — the same #41 guard as iOS.
- [ ] Verify (emulator, location granted so the run screen is the stage-2 one): start a run; logcat shows `TextToSpeech` utterance start/done for `warmupStart`; `dumpsys audio` focus stack gains the app's `GAIN_TRANSIENT_MAY_DUCK` entry during the utterance and loses it ~0.5 s after; skip a segment → `startRun`/`startWalk` speak; pause/resume → `paused`/`resumed`; End → `Speech.stop()` and the focus entry is gone.
- [ ] Verify the W3 double-cue case (halfway on a walk→run boundary) speaks both utterances with one focus request/abandon pair — use the compressed plan (Developer toggle) and a W3 session.

### Task 3: revert stage-1 stubs
**Files:** `src/services/onboarding.ts` + `onboarding.test.ts`, `src/app/onboarding/audio-cues.tsx`, `src/app/(tabs)/settings/index.android.tsx`.
- [ ] `audio-cues-v1` drops `platforms: ['ios']`; the Android test expects `welcome → audio-cues → location-primer`. `health-primer-v1` stays iOS-only.
- [ ] Audio-cues primer: the "Over your music" row says "Spotify or Apple Music … silent switch" — one `Platform.select` for that sentence ("Cues play over Spotify or YouTube Music — your music just dips for a moment." on Android). Everything else is already icon-paired and platform-true.
- [ ] Android Settings: section "Vibration cues" → "Coaching"; toggle descriptions mirror iOS's footer ("Interval cues call out each walk/run switch." / "Milestone cues add motivational spots — halfway, your last run, and finishing. A gentle vibration accompanies each cue while the screen is on."). Drop the stage-1 "Cues need the screen on" sentence: speech no longer does.
- [ ] Run banner copy check: "Cues stop when the screen sleeps. Tap the lock to keep them playing." is now **false on Android when location is granted** (the heartbeat speaks them) and true when denied — the same truth table as iOS, so leave it.

### Task 4: screen-off speech (the acceptance test of the stage)
- [ ] Location granted, run started, `adb emu geo fix` feed running (stage-2 recipe), `KEYCODE_SLEEP`, wait across a segment boundary, `KEYCODE_WAKEUP`. Expect logcat `TextToSpeech` done events for the boundary cue while `lifecycle` was `background`, and the focus stack entry appearing/disappearing around it. If the emulator was booted with `sound: true`, also listen.
- [ ] Location denied, screen off: no heartbeat, no cue (stage 2 measured this) — confirm nothing regressed and no focus entry leaks.
- [ ] Record: utterance latency from `cue` row to TTS start, whether Google TTS needed the warm-up, and whether any utterance was dropped while backgrounded.

### Task 5: docs
- [ ] ADR 0009: dated amendment "Android mechanics realised" — focus via the connector, B and C as the alternatives considered, `language: 'en-US'`, engine warm-up, what `setIsAudioActiveAsync` does and does not do on Android, haptic gate decision.
- [ ] ADR 0025: stage-3 row → **Built <date>**; amendment noting the first local Expo module and the audio-cues primer's one-line fork.
- [ ] AGENTS.md: Android bullet gains `boot-device sound:true`, the `dumpsys audio` focus-stack recipe, and `modules/` as the home of local native connectors.
- [ ] Memory: `android-stage-3.md` with what surprised you; mark this handoff superseded.

## Deferred (not this stage)
- Route map (stage 4, Maps key); Health Connect (5); elevation (6); Maestro on Android + `e2e-android` (7).
- `POST_NOTIFICATIONS` for the tracking notification (open from stage 2; product decision, not a cue mechanic).
- Localised phrases: still English-only by design (ADR 0009); `language: 'en-US'` is what makes that honest on Android.

## As built (2026-09-21)

Every task landed on `ll/android-stage-3` (branched from `ll/android-onboarding-carousel-design`); deviations and findings, in the order they bit:

- **Task 1 needed no iOS/web stub.** `platforms: ["android"]` keeps the module out of iOS autolinking, and the wrapper is `modules/audio-focus/index.android.ts`, imported only from `adapter.android.ts` through a new `@/modules/*` tsconfig alias — the iOS project and bundle never see it. Scaffolded with `create-expo-module --local --platform android`, then trimmed (Expo's LICENSE, the empty types file and the web stub removed). The Kotlin needed one fix: an Expo `Function` lambda's return type is inferred from its body, so an early `return@Function` (Unit) against an `Int`-valued `?:` chain does not compile — the bodies moved into plain private functions.
- **The iOS fingerprint did not move for the module** (`9061ec14…` before and after): an Android-only local module is not an iOS fingerprint source; the plan expected the opposite. It *did* move — caught while researching stage 4 — when a `/modules/*/android/build/` rule was added to the root `.gitignore`, because the root `.gitignore` is a fingerprint source (`bareGitIgnore`). The rule moved into `modules/audio-focus/android/.gitignore`, which is outside the iOS source set; the hash is back at `9061ec14…`.
- **Task 2 verified**: `requestAudioFocus` 3–47 ms after the `cue` row with `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE/CONTENT_TYPE_SPEECH req=3`; abandon 0.52 s after the utterance's `AudioTrack` stop (the debounce); `warmupStart`, `startRun`, `startWalk`, `paused`, `resumed` all spoke on the real plan; End cleared the focus; W3's `startRun`+`halfway` (2 ms apart) both spoke under one request/abandon pair. The engine was bound 33 ms before the first cue on a warm Google TTS; a cold engine process delayed the first utterance ~2 s and `prepare()` cannot hide that (it runs at the same instant as the first cue).
- **Task 4 found the stage's one real defect.** Cues fire and speak with the screen off when location is granted (`lastRun`, `cooldownStart`, `complete` played while `lifecycle` was `background`), but the un-duck after `complete` came 9.5 s late — on WAKEUP. RN suspends JS timers while the activity is paused (`JavaTimerManager.doFrame`), and a completed run stops the heartbeat that would otherwise wake JS, so the 500 ms release `setTimeout` never fired. Fixed in `adapter.android.ts` only: an immediate injected timer makes the release synchronous from the terminal callback (re-measured: 47 ms after the utterance, screen off); the in-flight count alone coalesces queued utterances. `release-scheduler.ts` and iOS untouched; ADR 0009 amended.
- **Location denied, screen off:** nothing fires in the dark (no `tick`, no `cue` for 69 s); the run→walk boundary spoke 41 s late on wake. Stage 2's finding holds with speech; the banner copy is right.
- **Observed once, not reproduced:** one run's first utterance did not un-duck at its end; the abandon came after two later cues, 15 s in. `tick` rows were regular (no JS stall); four later runs incl. a cold relaunch were clean. The emulator was thrashing (another dev client ANR-ed) at the time.
- **Compressed-plan artefact, not a defect:** with 2-second segments the TextToSpeech queue never drains, so a whole run body can be one focus hold and cues speak seconds behind their rows. Use the real plan for anything timing-related.
- **Emulator traps this stage:** `/data` at 0.9 GB free failed Gradle's `installDebug` (`INSTALL_FAILED_INSUFFICIENT_STORAGE`, two staged copies) — `adb install -r` of the built APK streams one copy and worked; a `pm revoke` puts the app in the stopped state; the denied-location Settings gains an "Open Settings" row and shifts the Developer rows down (two misses at the old coordinates); another dev client launched on the emulator mid-run (`am start` from adb) took the transport taps meant for RunBro — force-stopping that client and relaunching was the recovery.
- **Not done here:** the run-end un-duck timing on a physical device (Milestone-0 checklist), and warming the TTS engine earlier than `prepare()` (a follow-up if cold-engine latency shows on devices).
