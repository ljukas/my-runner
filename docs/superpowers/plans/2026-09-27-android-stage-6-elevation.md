# Android Stage 6 — Elevation Capture

> Built in one session on `ll/android-stage-6` (worktree `.claude/worktrees/android-stage-6`), branched from `ll/android-stage-5` (PR #67, stacked on #66 → #65 → #63 → #62 → #61). Unlike stages 2–5 there was no separate handoff: the design was settled in-session and is recorded here, with the "As built" section at the end. Read with [ADR 0025](../../adr/0025-android-staged-migration.md) (row 6 + the 2026-09-27 amendment) and [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md)'s 2026-09-27 amendment, which hold the mechanics and measurements.

**Goal:** an Android run on a phone with a barometer records altitude samples, a step count and the field diagnostics exactly as iOS does, with the screen off, and the summary's field-data export and the field-test Settings row work on Android. iOS unchanged. Elevation stays unrendered on both platforms.

**Spec:** ADR 0025 row 6 ("Barometer where the hardware has one, GPS-altitude fallback otherwise (ADR 0015); field export returns. Plugs in at `elevation/adapter.android.ts`; `run-export-row.android.tsx` stub goes.").

## 1. Verified facts that shaped the design (2026-09-27, installed sources)

- **expo-sensors cannot serve a screen-off run on Android.** `SensorProxy.kt`'s `UseSensorProxy` maps `OnActivityEntersBackground` → `onHostPause()` → `unregisterListener`, for every sensor module. Stock `Barometer` therefore records nothing once the screen sleeps, foreground service or not.
- `BarometerModule.kt` emits `{ pressure, timestamp }` only (no relative altitude — a literal upstream TODO) and declares no permission functions. `PedometerModule.kt`'s `getStepCountAsync` throws `NotSupportedException` on Android; its `get/requestPermissionsAsync` do work (ACTIVITY_RECOGNITION, API 29+), and expo-sensors' manifest already declares the permission.
- GPS altitude has been captured into `run_points` on Android since stage 2 (`location-tracker/adapter.android.ts` → `flush-transaction.ts`), but expo-location reports it as WGS84 ellipsoidal height and writes `0` when the fix has none (`LocationResults.kt` has no `hasAltitude()` check).
- `AltitudeReading.pressureHpa` is required, so a GPS reading cannot pass through the `ElevationSource` port — the GPS fallback is a render-time source choice (ADR 0015 item 2), not an adapter path.

## 2. Decisions (settled 2026-09-27)

1. **Scope: capture parity.** No rendering on either platform; ADR 0015 is still waiting on real field captures to tune the barometer config.
2. **Relative altitude is derived in pure TS** from pressure against each epoch's first reading (standard-atmosphere formula), so Android exports read like iOS ones.
3. **Native step counter** via `TYPE_STEP_COUNTER` rather than skipping the count on Android.
4. **1 Hz, batched** barometer cadence (matching iOS's measured 1.065 s).
5. **Architecture: a step-counter port** (option B of two drafted designs) rather than hiding the step baseline inside the barometer adapter — a phone may have a counter without a barometer, and the `(start, end)` function type could not honestly describe an armed-at-start count. With three amendments from comparing the drafts: keep a step listener for the whole run (on many devices the counter emits only on the next step, so a one-shot read at finalize can time out); thin pressure events by sensor timestamp, never wall clock (a wall-clock throttle drops most of a batched burst); ask ACTIVITY_RECOGNITION only in the foreground and never await it.

## 3. Task plan (as executed)

1. Baseline fingerprints (iOS dev `cbccdd29…`, variant-less `7daa9686…`; Android dev `e525fc07…`).
2. `modules/motion-sensors/` — Kotlin module (barometer + step counter on `SensorManager`, `onPressure` event, sync `Function`s), `index.android.ts`, nested `.gitignore`, `platforms: ["android"]`.
3. Pure helpers + tests: `relativeAltitudeFromPressure` (`elevation/reading.ts`), `stepsBetween` (`step-counter/reading.ts`).
4. `elevation/adapter.android.ts` on the module; port JSDoc for `sensorTimestampS` made platform-neutral.
5. `services/step-counter/` port + adapters; engine takes `StepCounterSource`, `queueElevation` → `queueSensor`; composition root drops its inline Pedometer call; engine tests for arm/release, re-arm on restore, and a hanging step start not stranding the barometer stop.
6. Delete `run-export-row.android.tsx`; add the field-test section to Android Settings.
7. Gates after each task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`.
8. Emulator verification (below), iOS regression flows, review, docs.

## As built (2026-09-27) — read before stage 7

- **Commits:** `fbea0a5` (feature), `7c48d2a` (1 Hz thinning, found on the emulator), `81730fa` (review fixes), then docs.
- **Emulator (`emulator-5554`, Pixel 10 Pro API 37):** the module's pressure registration survived `KEYCODE_SLEEP` (no unregister in `dumpsys sensorservice`, while the dev menu's expo-sensors `ShakeDetector` was dropped the same second); samples were gap-free through a 45 s screen-off window; a 7.2 hPa ramp read as a 60.5 m climb; the summary's Field data card showed its counts and the export produced a complete `runbro-export/1` file via the Android share sheet; the field-test row started and ended a capture (no Health Connect row on its summary, as intended).
- **A finding that changed the code:** the first build stored ~10 samples a second. Play services' location validation registers the pressure sensor at 100 ms during any location session and Android delivers every event to every client, so the requested period is only a hint. The module now thins by sensor timestamp (≥ 0.95 s); measured after: exactly 1.0 s between samples, screen on and off.
- **Not exercised (device checklist E1–E4):** the emulator image has no step counter (only the `steps: null` path ran) and no sensor FIFO, so batching across real CPU suspension, real step counts, the ACTIVITY_RECOGNITION dialog and Doze behaviour need a phone.
- **iOS:** fingerprint unchanged (dev `cbccdd29…`, variant-less `7daa9686…`, also after a local Gradle build); Android moved to `c74f4b13…`. Targeted Maestro flows `complete-session`, `run-controls`, `run-resume` passed on an iOS 26.5 simulator after the feature and again after the review fixes (fresh `e2e-simulator` build, fingerprint `ddabf451…`, install verified by bundle hash).
- **Found along the way, not fixed here:** the iOS 27.0 simulator crashes the app at launch because iOS 27 (with Xcode 27) requires the UIScene lifecycle — see AGENTS.md's E2E section. Every Maestro flow fails on 27.x until it is adopted.
- **Review (three reviewers)** led to: gating the Android step counter on the barometer (no pointless ACTIVITY_RECOGNITION dialog), `@Volatile` step counts, batching the step counter, clearing a registration left by a JS reload, rewording the step-counter port contract, one shared `hasBarometer()`, `startSensors()`/`stopSensors()`, stale-comment fixes and a padded field-test button.
- **Handoff for stage 7 (release pipeline):** not yet written.
