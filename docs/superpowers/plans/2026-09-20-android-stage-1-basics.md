# Android Stage 1 — Basics Implementation Plan (as built)

> **For agentic workers:** this stage is built; the checkboxes below record what landed and are the template for the later stages' plans. Later stages: write a plan in this shape *before* building, then amend [ADR 0025](../../adr/0025-android-staged-migration.md)'s stage table when done.

**Goal:** Every plan week runs on Android with the run engine driving the session, clock + vibration cues only, and a Material 3 UI that is deliberately not a copy of the iOS one — with the iOS app byte-for-byte equivalent at runtime.

**Architecture:** Android re-enters behind the existing seams (ADR 0003 ports, ADR 0013 `island/` seam, ADR 0005 §4 view forks). Every port gets an `adapter.android.ts` (inert where the capability is deferred); the `island/` modules become `.ios.tsx`/`.android.tsx` pairs; the three pure-SwiftUI tab routes get `index.android.tsx` siblings; SwiftUI-vocabulary components that need an Android body are renamed `.ios.tsx` and paired. Shared screens change by at most one behaviour-identical line. Colour is the device's Material palette pushed into both the Compose hosts and Uniwind's CSS variables. Governing decisions: ADR 0025.

**Tech Stack:** Expo SDK 57 · React Native 0.86 · `@expo/ui` 57.0.9 (`jetpack-compose` entry point) · expo-router 57.0.10 (NativeTabs Android) · expo-symbols (Material Symbols) · react-native-pulsar (Android haptics) · Uniwind · Skia · Bun · argent 0.25.2 on a Pixel 9 Pro API 36 emulator

**Governing ADRs:** 0003 (amended 2026-09-20), 0005 (amended), 0008 §5, 0009 §7, 0013 (amended), 0016, 0019, 0020 (superseded), 0025.

## Global Constraints

- **iOS must not change.** Only renames (`git mv` to `.ios.tsx`), type-only widenings, and one-line indirections whose iOS branch equals the old behaviour. The full iOS Maestro suite is the acceptance gate.
- **No location, speech, map, Health, elevation, Live Activity.** Each is a later stage; stage 1 only makes their ports resolve.
- **Route forks must import only modules that resolve on iOS too** — expo-router bundles every platform's routes into both bundles.
- **Icon names are `{ ios, android }` pairs**; verify Android names against `node_modules/expo-symbols/src/android/symbols.json`.
- **Metro on 8087** (8081/8082 belong to the owner). `APP_VARIANT=development` for every Expo command.
- **Objective gate per task:** `bun run lint && bun run typecheck && bun run typecheck:android && bun test`.
- Comments WHY-only; architecture in ADR 0025.

## Task Order and Why

Config first so the Gradle build (the long pole) runs in the background. Adapters next because Metro cannot bundle for Android until every `./adapter` resolves. Then the island seam, then the run-screen forks (the core of "runnable"), then the three tab routes (the largest chunk, done once theming and icons are proven), then the emulator pass and docs.

---

### Task 1: Config and native build
- [x] `app.json` `platforms: ["ios", "android"]`; `package.json` `android`, `prebuild:dev:android`, `typecheck:android` scripts
- [x] `tsconfig.android.json` (`moduleSuffixes` `[".android", ".native", ""]`, excludes `**/*.ios.*` + the three route fallbacks); `tsconfig.json` excludes `**/*.android.*`
- [x] ESLint: TypeScript import resolver gets Expo's platform extensions; type-aware rules take both projects; `no-restricted-imports` guards per suffix
- [x] CI `checks` job runs `typecheck:android`
- [x] `expo run:android` prebuilds (HealthKit plugins are iOS-mod-only, verified) and installs on the emulator

### Task 2: Port adapters
- [x] `location-tracker/adapter.android.ts` reporting the new `'unsupported'` status; `RunLocationBanner` hides for it; iOS Settings record gains the key (dead on iOS)
- [x] `health/adapter.android.ts` (`'unavailable'`), `elevation/adapter.android.ts` (`isAvailable` false), `route-map/adapter.android.tsx` (empty view)
- [x] `cue-service/cue-haptics.ts` extracted from the iOS adapter; `cue-service/adapter.android.ts` haptic-only, foreground-gated
- [x] `haptics/adapter.ios.ts` → `adapter.ts` (Pulsar is cross-platform)

### Task 3: Island seam and theme
- [x] `island/{host,button,text,label,icon-button,view}.ios.tsx` (renamed) + `.android.tsx` (Compose `Host`/`Button`/`OutlinedButton`/`Text`/`Column`; RN `Pressable` + `SymbolView` for icon buttons and labels)
- [x] `hooks/use-theme.android.ts` + `constants/material-theme.android.ts` (device palette → token names); `lib/platform-theme.android.ts` pushes it into Uniwind at launch from the root layout

### Task 4: Run screen
- [x] `run-transport.android.tsx` (RN row + Compose `AlertDialog`), `run-lock.android.tsx` (RN long press; both handlers always mounted — see ADR 0025 Context), `run-unavailable.android.tsx`, `stat-grid.android.tsx`; iOS bodies renamed `.ios.tsx`
- [x] `runHoldsScreenAwake(locked)` — whole run on Android; `SegmentSymbols` and stat-grid icons as pairs; Skia countdown names the platform font family
- [x] Summary stubs: `route-map-card`, `health-status-row`, `run-export-row` `.android.tsx` render nothing

### Task 5: Tab routes and onboarding
- [x] `(tabs)/_layout.tsx` `md` icons; `(index)/index.android.tsx`, `log/index.android.tsx`, `settings/index.android.tsx` (Compose `LazyColumn`/`ListItem`/`Switch`); `settings-toggle.android.tsx`; `list-section-header.android.tsx` + `.ios.tsx` stub; the Plan row promoted out of both route files into `plan-session-row.{ios,android}.tsx` (ADR 0013 §1 — a verbatim move on iOS)
- [x] `ONBOARDING_STEPS` carry `platforms`; `createOnboarding(storage, platform)`; `onboarding-store.ts` reads `Platform.OS`; test added

### Task 6: Verification (argent, emulator-5554)
- [x] Onboarding: welcome → Continue → tabs; reset → welcome → tabs (no iOS-only steps)
- [x] Plan → Day 1 sheet → Start Session → run screen; countdown paints; pause/resume; lock dims transport; hold unlocks (adb hold — argent's synthetic hold does not register); skip; End → Material dialog → summary (no map/health/export rows); Log row; Settings switches
- [x] iOS spot check through the same Metro: Plan (SwiftUI list), Settings (Form) unchanged; full iOS Maestro suite is the owner's gate before merge
- [x] Fingerprint: iOS hash re-measured after the Gradle build (ADR 0025 item 8). Recipe: `bunx expo-updates fingerprint:generate --platform ios > dirty.json`, then `rm -rf node_modules && bun ci` and generate `clean.json`, diff the `sources[].hash` by `filePath`; then `fingerprint.config.js` gained the manifest-normalising `fileHookTransform`, verified by hashing with the pristine and the Gradle-rewritten manifest in place

### Task 7: Docs
- [x] ADR 0025; ADR 0020 superseded; banners repointed; amendments to 0003/0005/0013; AGENTS.md; roadmap row; this plan

## Deferred from this stage (owned by later stages)
- Maestro on Android and an `e2e-android` CI lane (stage 7)
- Android `eas.json` profiles and Play submission (stage 7)
- Dark-mode and Dynamic-Type pass on Android (with stage 2's UI work)
