# 9. Cue audio: TTS on the shared audio session, pre-recorded drop-in fallback

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0020](0020-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

## Context

Spoken cues ("Start running", "Start walking", milestones — ~10 fixed
phrases, English only, spec §6) must be audible over the user's music, with
the silent switch on, through Bluetooth headphones, and with the phone
locked. ADR 0008 keeps the process alive while locked; this ADR decides what
produces the sound. The engine fires cues on derived-segment change
(ADR 0007) through the `CueService` port (ADR 0003).

Research findings (verified 2026-07-11):

- **expo-speech rides the app's audio session by default**
  (`useApplicationAudioSession` defaults to true; v57 docs). The docs also
  warn that on physical devices expo-speech is *silent when the device is in
  silent mode* — the default failure this design must defeat. Configuring
  the shared session with `playsInSilentMode: true` (Playback category) is
  therefore load-bearing, as is `shouldPlayInBackground: true` for
  locked-phone audibility. `Speech.speak` provides `onStart`/`onDone`/
  `onError` callbacks and voice/rate/volume options.
- **The un-duck mechanism exists and has precedent.** With
  `interruptionMode: 'duckOthers'`, other apps' audio ducks while our
  session is active; expo-audio v57 ships `setIsAudioActiveAsync(false)` to
  deactivate the session and restore other apps' volume. The
  "music stays ducked forever" bug class
  ([expo#19042](https://github.com/expo/expo/issues/19042)) was fixed in the
  expo-av era precisely via session deactivation; the reported
  `setAudioModeAsync` validation quirk
  ([expo#34902](https://github.com/expo/expo/issues/34902)) is closed and
  does not affect this configuration (`playsInSilentMode: true`).
- **The background fade-out risk is unresolved, not fixed:**
  [expo#19407](https://github.com/expo/expo/issues/19407) (TTS from a
  background location task fades out when the app is minimized) was **closed
  as stale**, without a verified fix. The risk class is empirically open on
  current SDKs — only the Milestone-0 device spike can settle it.
- **Haptic cues cannot complement audio while locked:** iOS does not play
  haptics from backgrounded apps (CoreHaptics/UIFeedbackGenerator are
  foreground APIs), so a vibration fallback for the locked-phone case is not
  buildable. They **are** available while the app is foreground with the
  screen awake — a state the run screen's screen-awake toggle (spec §8,
  decided 2026-07-11) deliberately preserves for the whole run. Note there
  is no app-controllable way to truly pin the app in the foreground (Guided
  Access is a user-level accessibility feature); keep-awake is the available
  primitive, and it prevents auto-lock only — a manual lock still hands off
  to the ADR 0008 background path.

## Decision

**TTS via expo-speech over the app's configured shared audio session, behind
a `CueService` port whose contract is a fixed cue-ID enum — with pre-recorded
audio files as the pre-approved drop-in fallback adapter.**

1. **The port speaks IDs, not strings.** `CueService.announce(cue: CueId)`
   takes a value from a fixed enum (~10 entries; phrase text lives with the
   cue script in `domain/`). This is what makes the pre-recorded adapter a
   true drop-in: one asset per `CueId`, same interface, no engine or screen
   changes.
2. **Session configuration** (at `prepare()`, i.e. run start):
   `playsInSilentMode: true` (defeats the silent switch — the documented
   default failure), `shouldPlayInBackground: true` (locked-phone
   audibility), `interruptionMode: 'duckOthers'` (music dips instead of
   pausing). expo-speech keeps its default `useApplicationAudioSession:
   true` so utterances inherit exactly this session.
3. **Duck-and-release lifecycle.** Music must dip only *around* utterances,
   not for the whole run: the session activates when an utterance starts and
   is released via `setIsAudioActiveAsync(false)` only after the *last*
   in-flight utterance's terminal callback (with a short debounce so
   multi-phrase moments don't flap). A per-utterance release is not enough
   (issue #41): back-to-back cues queue natively inside the shared
   `AVSpeechSynthesizer` — W3's halfway milestone lands exactly on a
   walk→run boundary — and deactivating the session mid-queue wedges the
   synthesizer, silencing every later cue. The adapter therefore counts
   in-flight utterances (`release-scheduler.ts`) and releases when the count
   returns to zero. `release()` at run end tears the session down
   unconditionally — the #19042 "stuck ducked" class is designed out, not
   hoped away.
4. **Failure is non-fatal.** `onError`/silent failures skip the cue and log
   to console; the screen still shows the transition (spec §11). No retries
   mid-run — a late cue is worse than a missed one next to an on-screen
   state that is already correct.
5. **Milestone-0 checklist owns the open risk** (spec §10): locked-phone
   audibility for 30+ min (the #19407 class), silent switch, Spotify
   dip-and-recover, Bluetooth headphones, phone-call interruption — on a
   physical device in release configuration. **Failure of TTS-while-locked
   flips the adapter, not the architecture** (decision pre-made in the
   spec).
6. **Fallback adapter (specified now, built only if triggered):** one
   bundled audio file per `CueId` (a fixed English script makes this cheap —
   assets can even be generated offline with AVSpeechSynthesizer at build
   time), played through expo-audio on the identical session configuration.
   Deterministic voice, no runtime synthesis, immune to TTS-specific
   background quirks.
7. **The screen-awake run mode keeps a haptic channel viable.** The run
   screen's keep-awake toggle (default on, persisted; spec §8) holds the app
   foreground and glanceable for the whole run. In that mode, haptic cue
   accents (expo-haptics — official) can fire behind the same `CueId`
   contract: `announce()` always goes to audio, and to haptics only while
   the app is foreground. Haptics are an **accent channel, never
   load-bearing** — timing correctness never depends on them (ADR 0007),
   and they silently no-op the moment the phone locks.

## Consequences

- The cue-ID contract keeps the sound-production choice reversible for the
  lifetime of the app: TTS ↔ pre-recorded is an adapter swap (ADR 0003's
  payoff), and a future localization pass changes the script table, not the
  port.
- Spotify dips only for the ~2 seconds around each cue — the experience the
  spec demands — because session release is an explicit, owned step rather
  than an assumed side effect.
- The known-bug landscape is now mapped: the ducking class has a mechanism
  and precedent; the fade-out class is *unconfirmed either way* on SDK 57,
  and the go/no-go evidence will come from Milestone 0, not from issue
  archaeology.
- Per-cue session activate/release adds small latency (~100 ms class) to
  each utterance. Irrelevant against a 1 s heartbeat cadence (ADR 0007).
- TTS voice quality varies with the device's installed voices; accepted for
  v1 (default English voice is always present). The fallback adapter is
  also the escape hatch if default-voice quality proves embarrassing.
- No locked-phone redundancy channel exists if audio fails (haptics are
  foreground-only on iOS) — one more reason cue failure must never affect
  timing correctness, which ADR 0007 already guarantees. In the screen-awake
  run mode the haptic accent channel does provide foreground redundancy;
  locked-phone runs remain audio-only by platform constraint.
- Android later: audio-focus ducking semantics differ; isolated inside the
  same adapter per ADR 0003.

## Alternatives considered

- **Pre-recorded files as the primary** — viable and more deterministic, but
  TTS-first was chosen: zero asset pipeline for v1, natural-sounding on
  modern iOS voices, and the fallback stays pre-approved one flip away. If
  Milestone 0 fails TTS-while-locked, this alternative simply becomes the
  decision.
- **react-native-tts** — rejected: community dependency (against the
  official-tooling policy) wrapping the same AVSpeechSynthesizer that
  expo-speech already wraps officially.
- **`useApplicationAudioSession: false`** (system-managed speech session
  with automatic ducking) — rejected as the default: automatic
  duck-and-recover is attractive, but the system session sits outside the
  `shouldPlayInBackground` configuration this app's locked-phone requirement
  depends on. Retained as a diagnostic lever during the Milestone-0 spike.
- **Haptic/vibration cues for the locked phone** — not buildable: iOS does
  not deliver haptics from backgrounded apps. Retained instead as the
  foreground accent channel enabled by the screen-awake run mode
  (Decision 7) — an accent, never the cue channel.
- **No audio (visual-only)** — Stage 1's honest state, rejected as the end
  state: audible coaching is the product's core loop.
