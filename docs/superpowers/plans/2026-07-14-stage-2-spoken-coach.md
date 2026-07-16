# Stage 2 — Spoken Coach (foreground) Implementation Plan

> **For agentic workers:** Use superpowers:test-driven-development for the pure
> layers (`domain/cues.ts`, engine cue-firing). Steps use checkbox (`- [ ]`)
> syntax for tracking. Follows the C25K design spec
> (`docs/superpowers/specs/2026-07-11-c25k-app-design.md` §13 Stage 2) and
> ADRs 0003, 0007, 0009, 0013.

**Goal:** The app coaches you **audibly** during a session — spoken cues on
every segment transition plus motivational milestones, over your music (ducked),
defeating the silent switch — with a matching **foreground haptic accent**.
Screen on or phone unlocked in a holder. Settings gains real cue toggles; a new
onboarding step introduces the cues.

**Honest limitation (spec §13):** cues stop if you lock the phone. Locked-screen
operation needs the background location heartbeat (ADR 0008) and lands in
Stage 3 — this stage does **not** enable background audio.

**Base:** stacked on `main` after PR #33 (animated run screen) merged.

## Architecture

Cue production sits behind the `CueService` **port** (ADR 0003), whose contract
is a fixed `CueId` enum — never strings — so the pre-recorded fallback (ADR 0009
§6) and Android audio-focus variant stay drop-in adapter swaps. The **engine**
fires cues on *derived-segment change* (ADR 0007 §4) and at milestones,
settings-blind; the **domain** owns cue policy (phrases, categories, haptic
pattern data, gating) as pure TS; the **iOS adapter** owns platform mechanics
(expo-speech, expo-audio session, Pulsar haptics, `AppState`). This is the
repo's **first platform fork**, so it introduces `moduleSuffixes` in
`tsconfig.json` (the moment ADR 0003 §3 reserved).

```
Data flow per cue:
engine.refresh()/pause()/resume()/finalize()   ← derives segment change / milestone
  └─ cueService.announce(cueId)                 ← unconditional, platform-blind
       └─ adapter.ios: spokenPhrase(cue, prefs) ← domain policy (settings-gated)
            ├─ Speech.speak(phrase, { duck → onDone → release })
            └─ Pulsar pattern (if AppState 'active')   ← foreground accent
```

## Global constraints

Inherited from AGENTS.md, the spec, and the ADRs (see the Stage 1 plan's Global
Constraints — all still apply). Stage-2-specific:

- **Verify SDK 57 APIs** against docs (Context7) — confirmed this stage:
  `expo-audio` `setAudioModeAsync({ playsInSilentMode, interruptionMode:
  'duckOthers' })` + `setIsAudioActiveAsync(false)`; `expo-speech`
  `Speech.speak(text, { rate, pitch, onStart, onDone, onError,
  useApplicationAudioSession })`; `react-native-pulsar` `Presets.System.*`
  (imperative) and `PatternComposer` / `usePatternComposer`.
- **Purity (ADR 0003/0007):** `domain/` and `engine.ts` import nothing from
  React/Expo/native. The engine receives `CueService` via constructor injection
  at the single composition root (`run-engine/index.ts`).
- **Foreground-only audio (spec §13):** session config is `playsInSilentMode:
  true` + `interruptionMode: 'duckOthers'` only. **No** `shouldPlayInBackground`,
  **no** `UIBackgroundModes: audio` — those land in Stage 3.
- **Failure non-fatal (spec §11, ADR 0009 §4):** a cue that fails to speak is
  logged to console and skipped; the on-screen transition is already correct.
  No mid-run retries.
- **New native deps → fingerprint change** → full dev-client + E2E rebuild:
  `expo-speech`, `expo-audio`, `react-native-pulsar` (Pulsar needs New Arch — on
  — and `react-native-worklets` — already present from #33).
- **Component conventions (ADR 0013):** reuse `SettingsToggle` and
  `OnboardingStepScreen`; screens compose only; no new primitive needed.
- **E2E (ADR 0016):** text-first selectors; audio itself is not E2E-assertable
  (device checklist) — Maestro asserts toggle presence/state + the onboarding
  step, plus the existing visual transition assertions during a compressed run.

## Cue script (9 cues)

`SEGMENT_KIND_LABEL` in `domain/format.ts` is the shared label table (already
earmarked "for later TTS cues"); cue phrases live in `domain/cues.ts`.

| CueId | Phrase | Category | Fires |
|---|---|---|---|
| `warmupStart` | "Let's warm up with a brisk walk." | interval | entering warmup |
| `startRun` | "Start running." | interval | entering a run (not the last) |
| `startWalk` | "Start walking." | interval | entering a walk |
| `cooldownStart` | "Cool down with a gentle walk." | interval | entering cooldown |
| `halfway` | "You're halfway there." | milestone | elapsed ≥ 50% of **planned** total |
| `lastRun` | "Last run. Finish strong!" | milestone | entering the final run segment |
| `complete` | "Workout complete. Great job!" | milestone | session completes |
| `paused` | "Paused." | interval | pause() |
| `resumed` | "Resumed." | interval | resume() |

**Gating policy** (`spokenPhrase(cue, { intervalCues, milestoneCues })`):
- Returns the phrase iff the cue's category toggle is on, else `null`.
- **lastRun fallback:** entering the final run returns "Last run. Finish
  strong!" when `milestoneCues` is on; if `milestoneCues` is off but
  `intervalCues` is on, returns "Start running." (so the transition is never
  silently dropped when interval cues are on).
- Both toggles off ⇒ everything returns `null` (fully silent).

## Haptic design (Pulsar, foreground accent)

Informed by Software Mansion's "Haptics is music" — meaning-mapped, designed
gaps, intensity reserved for the big moments, aligned with the audio cue.
Per-cue `PatternData` lives as **pure data in `domain/cues.ts`** (`amplitude`
0–1 = intensity, `frequency` 0–1 = sharpness), played by the adapter.

| Cue | Intent | Shape |
|---|---|---|
| `startRun` | go / effort up | one crisp assertive tap (amp≈1.0, freq≈0.85) |
| `startWalk` | ease off | soft rounded tap (amp≈0.5, freq≈0.4) |
| `warmupStart` | gentle intro | light single tap |
| `cooldownStart` | wind down | soft descending tap |
| `halfway` | progress marker | light double pulse (marker rhythm) |
| `lastRun` | finish strong | short rising crescendo (continuous ramp) |
| `complete` | celebration | clean double-pulse success + bright accent |
| `paused` / `resumed` | confirmation | soft low tap / soft brighter tap |

- Haptic fires **with** its audio cue (same gating), only while `AppState`
  is `'active'` (ADR 0009 §7 — no separate haptics setting in Stage 2).
- Play via Pulsar's imperative `PatternComposer` if the RN package exposes it;
  otherwise map each cue to `Presets.System.*` (e.g. `notificationSuccess` for
  `complete`, `impactMedium`/`impactLight` for run/walk) — same `domain/cues.ts`
  data drives either path. Verify the RN imperative surface in `node_modules`.
- Amplitudes/timings tuned on a real device (blog: motors differ); simulator
  uses `playAudioOnly()` to preview and confirm no crash.

## File structure (Stage 2 additions/edits)

```
src/
├── domain/
│   ├── cues.ts                  # NEW: CueId, CUE_PHRASE, CUE_CATEGORY, CUE_HAPTIC, spokenPhrase()
│   └── cues.test.ts             # NEW
├── services/
│   ├── cue-service/
│   │   ├── port.ts              # NEW: CueService interface (types only)
│   │   ├── adapter.ios.ts       # NEW: expo-speech + expo-audio + Pulsar
│   │   └── index.ts             # NEW: cueService singleton
│   ├── run-engine/
│   │   ├── engine.ts            # EDIT: inject cue port; fire on change + milestones
│   │   ├── types.ts             # EDIT: add cue to deps + CueId re-export path
│   │   ├── engine.test.ts       # EDIT: fake CueService, cue assertions
│   │   └── index.ts             # EDIT: inject cueService
│   ├── settings.ts              # EDIT: intervalCuesEnabled, milestoneCuesEnabled
│   ├── settings.test.ts         # EDIT
│   └── onboarding.ts            # EDIT: append audio-cues-v1
│   └── onboarding.test.ts       # EDIT
├── app/
│   ├── (tabs)/settings.tsx      # EDIT: 'Coaching' Section (two SettingsToggle)
│   └── onboarding/audio-cues.tsx# NEW: informational primer step
├── constants/theme.ts           # (only if a coaching icon/token is needed)
tsconfig.json                    # EDIT: moduleSuffixes [".ios",".native",""]
app.json                         # (no plugin change expected)
.maestro/
├── helpers/complete-onboarding.yaml  # EDIT: add audio-cues step
└── tests/settings-cues.yaml     # NEW: toggle presence/state
```

## Tasks

### 1. `domain/cues.ts` (TDD)
- [ ] RED: `cues.test.ts` — `spokenPhrase` returns phrase when category on, `null` when off; lastRun fallback (milestone-off + interval-on ⇒ "Start running."); both-off ⇒ null; `CUE_PHRASE`/`CUE_CATEGORY`/`CUE_HAPTIC` cover all 9 `CueId`s.
- [ ] GREEN: `CueId` union, phrase/category/haptic tables, `spokenPhrase()`.
- [ ] `bun test src/domain/cues.test.ts` green; `SEGMENT_KIND_LABEL` reused where sensible.

### 2. Engine cue-firing (TDD)
- [ ] RED: extend `engine.test.ts` with a fake `CueService` recording `announce`/`prepare`/`release`; assert: warmup cue at start; startRun/startWalk on transitions; halfway at 50% planned; lastRun entering final run; complete on completion (not endEarly); paused/resumed; prepare() on start, release() on finalize; no double-fire on repeated heartbeats; skip that crosses segments fires the entered segment's cue.
- [ ] GREEN: add `cue: CueService` to constructor deps (`types.ts`); track `lastAnnouncedIndex`, `halfwayFired`; compute `plannedTotal` + `lastRunIndex` at start; fire in `refresh()` (transition + milestones), `pause()`/`resume()`, `finalize()`; `prepare()`/`release()` lifecycle; reset trackers in `start()`/`reset()`.
- [ ] `bun test` green (all existing engine tests still pass).

### 3. `CueService` port + iOS adapter + composition
- [ ] `services/cue-service/port.ts` — `interface CueService { prepare(): void; announce(cue: CueId): void; release(): void }`.
- [ ] `tsconfig.json` — add `"moduleSuffixes": [".ios", ".native", ""]`; confirm `bun run typecheck` still passes.
- [ ] `services/cue-service/adapter.ios.ts` — `prepare()` sets audio mode (foreground config); `announce()` = `spokenPhrase()` gate → `Speech.speak(phrase, { onStart: activate/duck, onDone: debounced release })` + Pulsar haptic when `AppState.currentState === 'active'`; `release()` = `Speech.stop()` + `setIsAudioActiveAsync(false)`. All failures caught + `console.warn`.
- [ ] `services/cue-service/index.ts` — `export const cueService: CueService`.
- [ ] `run-engine/index.ts` — `new RunEngine({ persistence: dbRunPersistence, cue: cueService })`.

### 4. Settings toggles
- [ ] `settings.ts` — add `intervalCuesEnabled`/`milestoneCuesEnabled` (default `true`) to `SettingsValues`, `defaults`, `load()`.
- [ ] `settings.test.ts` — defaults, persistence, corruption-fallback for both keys.
- [ ] `settings.tsx` — new `<Section title="Coaching">` (non-dev) with `<SettingsToggle label="Interval cues" settingKey="intervalCuesEnabled" />` + `<SettingsToggle label="Milestone cues" settingKey="milestoneCuesEnabled" />`.

### 5. Onboarding step
- [ ] `onboarding.ts` — append `{ id: 'audio-cues-v1', route: '/onboarding/audio-cues' }` after `welcome-v1`.
- [ ] `onboarding.test.ts` — update expected step list; pending/complete for the new id.
- [ ] `src/app/onboarding/audio-cues.tsx` — `OnboardingStepScreen` + `FeatureRow`s explaining spoken cues + silent-switch behaviour; informational (cues default on).
- [ ] `.maestro/helpers/complete-onboarding.yaml` — add the new step (assert heading, tap Continue).

### 6. Native install + rebuild
- [ ] `bun expo install expo-speech expo-audio react-native-pulsar`.
- [ ] `bun expo prebuild` (or rely on run:ios); confirm no manual `app.json` plugin edits needed.
- [ ] `bun expo run:ios` — new dev-client build; Metro regenerates typed routes for the new route.

### 7. E2E + verification
- [ ] `.maestro/tests/settings-cues.yaml` — navigate to Settings, assert Coaching section + both toggles, flip one, assert state.
- [ ] `maestro test .maestro/` — full suite green (onboarding now includes the audio step).
- [ ] Simulator (argent): run a compressed session; confirm cues fire audibly on each transition + milestones + completion; toggles change behaviour; no crash from Pulsar on sim.
- [ ] `bun run lint && bun run typecheck && bun test` — all green.
- [ ] Device checklist (manual, not CI): silent switch, Spotify dip-and-recover, Bluetooth headphones, haptic feel (real device).

## Exit criteria (spec §13)

A session runs end-to-end with correct spoken cues over playing music and
matching foreground haptics; cue toggles work; the onboarding audio step
appears for new users and existing users who haven't seen it; stage flows pass;
`lint`/`typecheck`/`bun test` green. Locked-screen operation remains a
documented Stage 3 gap.

## Deliberately absent (Stage 3+)

Locked-screen cues, `shouldPlayInBackground`/`UIBackgroundModes: audio`,
background location heartbeat, crash-resume "Resuming your workout" cue,
pre-recorded fallback adapter (pre-approved, built only if Milestone-0 fails).
