# Android Stage 2 — Location & Background Heartbeat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This is a **handoff**: stage 1 shipped on PR #61 (`ll/android-stage-1`); this branch (`ll/android-stage-2`) stacks on it. Read [ADR 0025](../../adr/0025-android-staged-migration.md) and the [stage 1 plan](2026-09-20-android-stage-1-basics.md) first — every gotcha there still applies.

**Goal:** An Android run keeps its heartbeat with the screen off and the phone in a pocket: location fixes flow into the engine through a foreground service, cues fire on time, distance and pace appear on the run screen and summary, and the display is held only while the run lock is on — the same contract iOS has (ADR 0008), with Android's mechanics.

**Architecture:** Replace the inert `src/services/location-tracker/adapter.android.ts` with a real adapter over `expo-location` + `expo-task-manager` (both ship Android native modules), behind the unchanged `LocationTracker` port. The engine, composition root (`src/services/run-engine/index.ts`, which already subscribes to `locationTracker.onFix` at module scope and calls `runEngine.heartbeat(fix.timestamp, fix)`), smoothing (ADR 0021), run screen, and summary are untouched: the adapter delivering fixes is what lights up distance, pace, `RunStatGrid`'s distance tiles, and the pace chart. The stage-1 `'unsupported'` status stops being returned on Android (the enum member stays; stage 1's banner/Settings branches remain harmless). Governing ADRs: 0003, 0008 (amend for Android mechanics), 0016, 0019, 0021, 0025.

**Tech Stack:** Expo SDK 57 · `expo-location` ~57.0.7 (Android foreground service via `startLocationUpdatesAsync({ foregroundService })`, config plugin `isAndroidForegroundServiceEnabled` / `isAndroidBackgroundLocationEnabled` / `androidForegroundServiceIcon`) · `expo-task-manager` ~57.0.7 · argent 0.25.2 on `emulator-5554` (Pixel 9 Pro API 36) · Metro on 8087

## Global Constraints

- **Read https://docs.expo.dev/versions/v57.0.0/sdk/location/ and /sdk/task-manager/ first**, and verify every option against `node_modules/expo-location/src/Location.types.ts` (e.g. `LocationTaskServiceOptions` = `notificationTitle`, `notificationBody`, `notificationColor`, `killServiceOnDestroy`). Context7 is fine for these two packages.
- **iOS must not change.** `adapter.ios.ts` is untouched. `app.json` plugin edits must be Android-only keys. Shared files may gain a per-platform seam only where stage 1 already did (`runHoldsScreenAwake`, `sheetOptions`, `navigationTheme`).
- **Android gotchas from stage 1 (all still true):** expo-router bundles every platform's routes into both bundles — a route fork's imports must resolve on iOS; the iOS/Android tsconfigs partition the tree (`typecheck` + `typecheck:android`); `expo-symbols` names are `{ ios, android }` pairs; argent's synthetic long press does not register (use `adb shell input swipe x y x y 1500`); after `bun run android` the fingerprint hook keeps the iOS hash stable — if it drifts, diff the fingerprint sources before/after `rm -rf node_modules && bun ci` and extend the hook, don't reinstall forever.
- **Native change ⇒ full rebuild.** The expo-location plugin change (foreground service, permissions, notification icon) alters `AndroidManifest.xml`; run `bun run prebuild:dev:android` then `bun run android` (Gradle ≈ 5–10 min). Expect the fingerprint (both platforms) to change — that is what a native stage does.
- **No "always"/background-launch posture** (ADR 0008 §2): request foreground location only (`requestForegroundPermissionsAsync`); the foreground service is what keeps delivery alive with the screen off. Do **not** request `ACCESS_BACKGROUND_LOCATION`; leave `isAndroidBackgroundLocationEnabled` unset (the plugin then adds the foreground-service permissions only when `isAndroidForegroundServiceEnabled: true` — read `withLocation.js` lines 105–140 to confirm which permissions each flag adds).
- **Android 13+ notifications:** the foreground-service notification is shown without `POST_NOTIFICATIONS` (FGS notifications are exempt), but verify on the API 36 emulator and record the finding in ADR 0008's amendment. Do not add `expo-notifications`.
- **Comments WHY-only; architecture in ADR 0025/0008.** Objective gate per task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`.
- Metro on **8087**; `APP_VARIANT=development`; never touch `bun.lock`/`CHANGELOG.md`/`version` by hand; `export COREPACK_ENABLE_AUTO_PIN=0`.

## Task Order and Why

Config first because it forces the one native rebuild. The adapter next, verified against the emulator's own GPS route engine (`adb emu geo fix`) before any UI changes, so distance appearing on the run screen is a *consequence* of fixes flowing, not a UI edit. Then the reversions of stage-1 stubs (keep-awake, onboarding primer, Settings row). Then screen-off verification, which is the whole point of the stage. Docs last.

---

### Task 1: expo-location Android config
**Files:** Edit `app.json` (the `expo-location` plugin entry), `docs/adr/0025-android-staged-migration.md` (stage table only at the end).
- [ ] Add to the `expo-location` plugin config: `"isAndroidForegroundServiceEnabled": true`, `"androidForegroundServiceIcon": "./assets/images/android-icon-monochrome.png"` (monochrome, as the notification small icon must be). Keep every iOS key as is.
- [ ] `bun run prebuild:dev:android`; confirm `android/app/src/main/AndroidManifest.xml` gained `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` and the location service with `foregroundServiceType="location"`; confirm **no** `ACCESS_BACKGROUND_LOCATION`.
- [ ] `bun run android` (full Gradle). App boots; stage-1 flows still pass.

### Task 2: the real `adapter.android.ts`
**Files:** Rewrite `src/services/location-tracker/adapter.android.ts`; read `adapter.ios.ts` as the template (same `listeners` Set, same `toFix`, same `toStatus` mapping via `canAskAgain`).
- [ ] Module-scope `TaskManager.defineTask(LOCATION_TASK, …)` fan-out identical to iOS (headless delivery must be registered at bundle-eval, ADR 0008 §4). Same task name is fine — the platforms never share a process.
- [ ] `requestPermission()` / `getPermissionStatus()` via `requestForegroundPermissionsAsync` / `getForegroundPermissionsAsync`, mapped to `'granted' | 'denied' | 'undetermined'` exactly as iOS does (`canAskAgain` decides `'undetermined'` vs `'denied'`). `'unsupported'` is never returned any more.
- [ ] `start()`: `startLocationUpdatesAsync(LOCATION_TASK, { accuracy: BestForNavigation, distanceInterval: 0, timeInterval: 1000, foregroundService: { notificationTitle: 'RunBro is tracking your run', notificationBody: 'Distance and cues keep working while the screen is off.', notificationColor: <primary hex from constants/theme>, killServiceOnDestroy: true } })`. Only after `granted`; idempotent; warnings non-fatal — mirror the iOS structure.
- [ ] `stop()` guarded by `hasStartedLocationUpdatesAsync` (the same idempotency reason as iOS).
- [ ] Verify on the emulator: grant location (`argent settings-permissions` or the in-app prompt from Task 4), start a run, then drive the emulator's route engine: `adb -s emulator-5554 emu geo fix 18.0686 59.3293` repeatedly with small deltas (a ~1 m/s walk is 0.00001° lat per second), or Extended Controls → Location → route playback. Distance and pace rows must appear on the run screen and the summary's Distance/Avg Pace tiles must render (`RunStatGrid` already gates on `hasMeasuredDistance`).
- [ ] Verify the foreground-service notification appears while a run is active and disappears on end/abandon (`stopIdleTracking` in the composition root already stops tracking when no run is live).

### Task 3: revert stage-1 holds
**Files:** `src/components/keep-awake-while-mounted.tsx`, `src/services/onboarding.ts` + `onboarding.test.ts`, `src/app/(tabs)/settings/index.android.tsx`, `src/components/run-location-banner.tsx` (no change expected).
- [ ] `runHoldsScreenAwake(locked)` → back to `locked` on both platforms (delete the `Platform` import and the ADR 0025 stage-1 comment; the lock is again the runner's own trade, ADR 0008 §5).
- [ ] `location-primer-v1` drops its `platforms: ['ios']`, so Android sees welcome → location primer. Update the test that asserts Android sees only `welcome-v1` (it now sees two steps); keep the audio-cues and health primers iOS-only.
- [ ] Android Settings gains a **Location** section (Material list rows) mirroring the iOS one's states: `granted` → "While using the app" + footer copy; `denied` → "Open Settings" (`Linking.openSettings()`); `undetermined` → "Enable location". Reuse `useLocationPermission()` (already cross-platform; it re-reads on foreground).
- [ ] Check `RunLocationBanner`'s copy still tells the truth on Android for `denied`/`undetermined`: "Cues stop when the screen sleeps" is true there too without the service. Leave it.

### Task 4: screen-off heartbeat verification (the acceptance test of the stage)
- [ ] Start a run with location granted; put the display to sleep (`adb -s emulator-5554 shell input keyevent KEYCODE_SLEEP`); keep feeding `geo fix` for 90 s; wake (`KEYCODE_WAKEUP` + swipe). Expect: elapsed advanced, segment boundaries crossed on time, distance grew. Read `[cue]` and `fix_batch` evidence from the run's field log (the run-log export exists on iOS only; on Android read `runEngine.getSnapshot()` via `debugger-evaluate`, or add a temporary `console.log` you remove before commit).
- [ ] Repeat with location denied: confirm the honest degradation (timer correct, no distance, cues stop with the screen off) — the same contract as iOS.
- [ ] Record the measured cadence and whether Doze/App Standby interfered on the emulator in the ADR 0008 amendment.

### Task 5: docs
- [ ] ADR 0008: dated amendment "Android mechanics realised" (foreground service as the heartbeat, permissions posture unchanged, notification exemption finding, the stage-1 hold reverted).
- [ ] ADR 0025: stage-2 row → **Built <date>**; add `RunLocationBanner`/`'unsupported'` note if the enum member is kept; link this plan.
- [ ] AGENTS.md: the Android commands bullet gains the rebuild note for plugin changes and the `adb emu geo fix` recipe (Maestro cannot move the emulator either, ADR 0001's amendment applies to Android as well — verify and say so).
- [ ] Memory: update `android-stage-1.md` (or add `android-stage-2.md`) with what surprised you.

## Deferred (not this stage)
- Route map on Android (stage 4, needs a Maps key) — the summary's route card stays a null stub even though fixes are now recorded; the pace chart appears (Skia, cross-platform).
- Spoken cues (stage 3); Health Connect (5); elevation (6); Maestro on Android + `e2e-android` CI lane (7).
