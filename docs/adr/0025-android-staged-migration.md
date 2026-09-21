# 25. Android support: a staged migration behind the existing seams

Date: 2026-09-20

## Status

Proposed — draft for review. Flip to `Accepted` on merge. **Supersedes
[ADR 0020](0020-ios-only-android-deferred.md).** This ADR is the living record of
the migration: the stage table under Decision item 1 is amended (dated) as each
stage ships.

## Context

ADR 0020 shipped the app iOS-only "for now" and named the re-entry path: put
`android` back in `platforms`, restore an `android` script, and write
`adapter.android.ts` files behind the ADR 0003 ports. Every earlier ADR that
touched a platform capability pre-committed the *shape* of its Android half and
carried a deferral banner pointing at ADR 0020. That design debt is now being
paid in stages, and the stage plan needs one place to say what is built, what is
not, and where each capability plugs in.

Two product decisions frame every stage:

- **The two apps are not a 1:1 design.** iOS follows the Human Interface
  Guidelines with SwiftUI islands (ADR 0005); Android follows Material 3 with
  Jetpack Compose islands from the same `@expo/ui` package. Shared logic, forked
  views (ADR 0005 §4).
- **Android colour is dynamic.** The Android app takes its palette from the
  device wallpaper (Material You) on Android 12+, with the Material 3 baseline
  below that. It does not reuse the iOS palette.

Facts verified while building stage 1 (2026-09-20, Expo SDK 57, `@expo/ui`
57.0.9, expo-router 57.0.10, emulator Pixel 9 Pro API 36):

- `@expo/ui/jetpack-compose` ships a Material 3 vocabulary (`Button`,
  `OutlinedButton`, `TextButton`, `Switch`, `AlertDialog`, `ListItem`,
  `LazyColumn`, `Card`, `Column`/`Row`, `Host`) and a Material colour API:
  `getMaterialColors({ scheme })` returns the device palette, and a `Host`
  without `seedColor` themes its children from the wallpaper. Compose's own
  `Icon` takes bundled drawables, not glyph names.
- `expo-symbols` renders Material Symbols on Android from a `{ ios, android }`
  name pair; a bare SF Symbol string renders nothing there, silently.
- `expo-router/unstable-native-tabs` has an Android implementation and its
  `Icon` accepts `md` beside `sf`.
- **expo-router bundles every platform's route files into both bundles and
  evaluates them at startup.** A `.android.tsx` route is resolved and evaluated
  on iOS (and the iOS body on Android). Consequences: any module a route fork
  imports must resolve on both platforms, and the wrong platform's `@expo/ui`
  entry point being imported only *warns* (`Unable to get the view config …`),
  it never mounts. Component forks imported from shared screens do not have
  this property; they resolve per platform.
- `react-native-pulsar` ships an Android native module, so the haptic half of
  the cue adapter is cross-platform as written.
- The HealthKit config plugins only touch iOS mods; Android prebuild is clean
  with them present.
- Skia's `matchFont` default family name is iOS's; Android matches nothing for
  it and the countdown painted blank until the platform family was named.
- RN's `Pressable` only cancels the press that follows a long press while
  `onLongPress` is still set on release, so a lock whose handlers depend on the
  locked state re-locks on the finger lift.
- **Gradle pollutes the iOS fingerprint** exactly as ADR 0020 recorded. See
  Decision item 8 for the measured sources and the mitigation.

## Decision

### 1. The stages

Android support ships in stages, each a working app on its own, each with its
own plan under `docs/superpowers/plans/`. Every stage that adds a capability
does so by replacing an `adapter.android.ts` (or `.android.tsx` view) behind a
port that already exists; no stage re-plumbs the engine, domain, or shared
screens.

| Stage | Capabilities | Plugs in at | Status |
| --- | --- | --- | --- |
| **1 — Basics** | All plan weeks; run screen with clock, progress, transport, lock; vibration-only cues; run summary without map, health, export; Plan, Log, Settings; onboarding = welcome only. No location, no speech, no map, no Health, no elevation. Screen held awake for the whole run. | Every port's `adapter.android.ts`; `island/*.android.tsx`; Plan/Log/Settings route forks; run-transport, run-lock, run-unavailable, stat-grid forks. | **Built 2026-09-20**, verified on the emulator (plan → session → run → pause/skip/lock/unlock/end → summary → log → settings; onboarding gating). |
| 2 — Location & background | Foreground-service location (expo-location's Android config), fixes into the engine, distance and pace, the run keeps its heartbeat with the screen off; keep-awake reverts to lock-only. Location primer onboarding step returns. | `location-tracker/adapter.android.ts`; `runHoldsScreenAwake`; `RunLocationBanner`'s `'unsupported'` branch goes dead, not removed (see the 2026-09-21 amendment). | **Built 2026-09-21** — [plan](../superpowers/plans/2026-09-21-android-stage-2-location-heartbeat.md); mechanics and measurements in ADR 0008's 2026-09-21 amendment. |
| 3 — Spoken cues | expo-speech over Android audio focus (ducking semantics differ, ADR 0009); audio-cues onboarding step returns. | `cue-service/adapter.android.ts`; `modules/audio-focus/`, a local Expo module for transient may-duck focus (decided 2026-09-21). | **Built 2026-09-21** — [plan](../superpowers/plans/2026-09-21-android-stage-3-spoken-cues.md); mechanics and measurements in ADR 0009's 2026-09-21 amendment. |
| 4 — Maps | `GoogleMaps.View` behind the `RouteMap` port; needs a build-time Maps API key (`android.config.googleMaps.apiKey`, ADR 0010). Route card and viewer return to the summary. | `route-map/adapter.android.tsx`; delete the `route-map-card.android.tsx` stub. | Planned |
| 5 — Health Connect | `react-native-health-connect` behind `HealthAdapter` (ADR 0011); health onboarding step and Settings row return. | `health/adapter.android.ts`; `health-status-row.android.tsx` stub goes. | Planned |
| 6 — Elevation | Barometer where the hardware has one, GPS-altitude fallback otherwise (ADR 0015); field export returns. | `elevation/adapter.android.ts`; `run-export-row.android.tsx` stub goes. | Planned |
| 7 — Release pipeline | `eas.json` Android profiles, Play service account, `.eas/workflows/deploy-production.yml`'s existing Android jobs go live (ADR 0012), an `e2e-android` GitHub Actions lane with Maestro on the emulator (ADR 0001). | `eas.json`, `.github/workflows/`, `.maestro/` `appId` per platform. | Planned |

Live Activities (ADR 0022) stay iOS-only by nature; the Android adapter is a
no-op or, later, a foreground-service notification decided in stage 2.

The order is a recommendation, not a dependency chain, except that 2 precedes 4
(a map needs fixes) and 7 comes last. Each stage flips its row to *Built* with a
date in an amendment to this ADR.

### 2. View forks: Compose islands, RN + Uniwind elsewhere, iOS untouched

- The `island/` seam (ADR 0013) is forked per file: `host`, `button`, `text`,
  `label`, `icon-button`, `view` each exist as `.ios.tsx` (the former unsuffixed
  SwiftUI file, renamed) and `.android.tsx`; `index.ts` is shared and resolves
  per platform. Public props are identical on both sides so shared screens and
  components stay platform-blind.
- **Compose is used where it earns native fidelity**: text CTAs, dialogs, lists
  and list rows, switches. **Icon-only controls stay RN** (`Pressable` +
  `SymbolView` with a Material ripple): Compose's `Icon` cannot consume the
  app's glyph names, and one icon pipeline app-wide beats two.
- A component that imports `@expo/ui/swift-ui` directly and needs an Android
  fork is renamed to `.ios.tsx` and gets an `.android.tsx` sibling
  (`run-transport`, `run-lock`, `run-unavailable`, `stat-grid`,
  `settings-toggle`). Shared screens import the unsuffixed name and never
  change.
- Screens that are pure SwiftUI (Plan, Log, Settings) get an `index.android.tsx`
  sibling; the unsuffixed iOS file stays as expo-router's required fallback.
- Summary rows for capabilities Android lacks (`route-map-card`,
  `health-status-row`, `run-export-row`) have `.android.tsx` stubs that render
  nothing, so the summary screen file is untouched and the stubs vanish as their
  stages ship.
- Six shared files under `src/app/` changed, each behaviour-identical on iOS:
  the run screen's keep-awake goes through `runHoldsScreenAwake(locked)` (iOS
  branch `locked`); the tab layout gained `md` icon names; the root layout calls
  `applyPlatformTheme()` (a no-op on iOS), takes its navigation theme from
  `navigationTheme()` (iOS returns React Navigation's own themes; Android maps
  the Material palette so headers match the surface) and spreads `sheetOptions`
  into the form sheets (empty on iOS; Material's 28 dp corners on Android); the
  session sheet and the run summary carry Uniwind `android:` classes for the
  bottom safe-area offset and the header gap (compiled out on iOS); and the iOS
  Settings screen's location-label record gained the `'unsupported'` key its
  type now requires (never returned by the iOS adapter). The Plan row was promoted out of both
  route files into a `plan-session-row` pair (ADR 0013 §1), a verbatim move on
  iOS.

### 3. Adapters

Every port has an `adapter.android.ts` from stage 1, because Metro fails to
resolve `./adapter` for the Android bundle otherwise. Stage 1's are inert where
the capability is deferred: location reports a new
`LocationPermissionStatus` value, **`'unsupported'`** ("nothing to prompt for,
nothing to disclose"), which the run banner and Settings honour; health reports
`'unavailable'`; elevation reports unavailable (which is what keeps the
composition root away from the pedometer); the route map renders an empty
view. The cue adapter is haptic-only and shares `CUE_HAPTIC` with iOS through
`cue-service/cue-haptics.ts`. UI haptics dropped their `.ios` suffix: one Pulsar
adapter serves both platforms.

### 4. Colour

`src/hooks/use-theme.android.ts` maps the device's Material palette onto the
app's token names (`material-theme.android.ts`: `onSurface` → `text`,
`surface` → `background`, `surfaceContainerLow` → `backgroundCard`, `error` →
`destructive`, …; `success` has no Material role and keeps the shared value).
At launch, `applyPlatformTheme()` (root layout, module scope) pushes the same
palette into Uniwind's CSS variables for both schemes via
`Uniwind.updateCSSVariables`, so RN-rendered surfaces follow Material You too.
The iOS token values in `global.css` and `theme.ts` are untouched. Segment and
stat accents stay shared data colours.

### 5. Icons

Symbol names are `{ ios, android }` pairs at each call site (`SegmentSymbols`,
the stat-grid tiles, every Android fork). The iOS glyph is unchanged; Android
gets a verified Material Symbol name (`node_modules/expo-symbols/src/android/symbols.json`
is the source of truth — an unknown name is a blank, not an error).

### 6. Two TypeScript projects, one ESLint

- `tsconfig.json` anchors to iOS (`moduleSuffixes` `[".ios", ".native", ""]`)
  and **excludes `**/*.android.*`**; `tsconfig.android.json` anchors to Android
  and excludes `**/*.ios.*` plus the three unsuffixed route fallbacks. Every
  file is in exactly one project, so a fork is only ever checked against its
  own platform's island types. `bun run typecheck:android` runs beside
  `typecheck` in CI. This amends ADR 0003 item 3.
- ESLint's TypeScript import resolver is given Expo's platform extension list
  (it knows tsconfig paths but not Metro suffixes), the type-aware rules take
  both projects, and `no-restricted-imports` forbids `@expo/ui/swift-ui` in
  `.android` files and `@expo/ui/jetpack-compose` in `.ios` files — the wrong
  vocabulary is a runtime crash, not a type error.

### 7. Onboarding

Steps may declare `platforms`; `createOnboarding(storage, platform)` filters by
it, and `onboarding-store.ts` is the only onboarding module that reads
`Platform.OS` (the pure `onboarding.ts` stays `bun test`-able).
`welcome-v1` shows everywhere; the three primers are iOS-only until their
stages land. Unit-tested under `bun test`.

### 8. The fingerprint and local Android builds

Re-enabling Android reintroduces the mechanism ADR 0020 removed, and stage 1
measured it precisely (2026-09-20: clean `bun ci` tree vs. the same tree after
`expo run:android`, iOS fingerprint sources diffed). `@expo/fingerprint` already
ignores `**/android/build/**`, `.cxx` and `.gradle`, so Gradle's build output is
harmless. **Exactly one source moved**: the whole-package directory of
`@react-native-masked-view/masked-view`, because AGP 8's namespace migration
rewrites its `android/src/main/AndroidManifest.xml` in place, deleting the
legacy `package="org.reactnative.maskedview"` attribute (the only dependency in
the set that still carries one). The **iOS** fingerprint hashes that whole
package directory (`rncoreAutolinkingIos`), so an `eas build --local -p ios`
after a local Android build failed its runtime-version check.

Mitigation, shipped in `fingerprint.config.js`: a `fileHookTransform` that
hashes every `AndroidManifest.xml` with the `package` attribute stripped and
whitespace normalised. The attribute is dead under AGP 8 (the namespace comes
from `build.gradle`), so nothing real is lost, and both tree states hash the
same — verified by generating the iOS fingerprint with the pristine and the
Gradle-rewritten manifest in place. `rm -rf node_modules && bun ci` remains the
fallback if a future package mutates something else; the diff recipe is in the
stage 1 plan.

### 9. Verification split

Stage 1 is verified interactively with argent on the emulator (AGENTS.md). Maestro
on Android is stage 7's concern, together with the CI lane; ADR 0016's text-first
selectors are expected to transfer as-is (Compose merges a row's text into one
node, e.g. `"Day 1 / Up next / 29 min"`).

### 10. Documentation discipline

- This ADR's stage table is the source of truth for "where are we"; each stage
  amends it and links its plan.
- The deferral banners from ADR 0020 now point here and name the stage that
  owns each ADR's Android provisions.
- AGENTS.md carries the Android commands and gotchas; ADR 0020 is marked
  superseded and kept as the record of why Android was paused.

## Consequences

- Android is a shipping target again, with the iOS app byte-for-byte equivalent
  at runtime: the only shared-file edits are behaviour-identical on iOS
  (renames, type widenings, one-line indirections), and the full iOS Maestro
  suite is the acceptance gate for that claim on every stage.
- Later stages are adapter replacements plus stub deletions. Nothing in stage 1
  has to be undone except the stubs and the `'unsupported'` branches.
- Cost: two `@expo/ui` vocabularies on top of the RN one; contributors must know
  which file suffix owns which. The ESLint guard and the tsconfig split make the
  wrong mix fail fast.
- Cost: Metro warnings at startup on both platforms from the other platform's
  route bodies. Harmless, but noisy; a cleaner route-forking mechanism is a
  question for expo-router upstream, not this repo.
- Cost: `android/` prebuild output is gitignored like `ios/`, and a local
  Android build dirties `node_modules` for iOS local builds until reinstalled
  (item 8).
- `expo-doctor` will report Android-side drift now; that stays with the weekly
  job (ADR 0012), not the PR gate.

## Alternatives considered

- **Universal `@expo/ui` layer instead of `jetpack-compose`** — rejected: a
  third vocabulary with less Material coverage; iOS uses `swift-ui` directly,
  Android uses `jetpack-compose` directly, symmetric.
- **Whole-file `run.android.tsx` fork** — rejected: duplicates the engine
  wiring that stage 2 would then have to re-merge; the `'unsupported'` status
  and one keep-awake indirection cost less.
- **`Platform.OS` guards inside the summary screen** — rejected in favour of
  null-rendering Android stubs: the screen file stays untouched and each stub
  is deleted by the stage that replaces it.
- **Static Material palette seeded from the brand colour** — rejected by
  product decision: dynamic colour is the Android-native choice, and the
  mechanism to feed it into Uniwind exists.
- **One tsconfig with both suffixes** — impossible: `moduleSuffixes` is an
  ordered resolution list, so one project can only anchor to one platform.

## Affected ADRs

Banners repointed from ADR 0020 to this ADR, naming the owning stage: 0001 (7),
0002 (1), 0003 (1), 0005 (1), 0006 (1), 0008 (2), 0009 (3), 0010 (4), 0011 (5),
0012 (7), 0013 (1), 0015 (6), 0017 (later), 0022 (iOS-only by nature), 0023 (1).
Amendments added to 0003, 0005 and 0013; 0020 marked superseded.

## Amendment (2026-09-21): stage 2 built — location and the foreground-service heartbeat

Stage 2 shipped as planned: `location-tracker/adapter.android.ts` is a real
adapter over `expo-location` + `expo-task-manager`, the engine and shared
screens are untouched, and distance, pace, the summary's distance tiles and the
pace chart light up on Android because fixes flow. What the plan did not
foresee, and what changed beyond it:

- **`android.permissions` gains `RECEIVE_BOOT_COMPLETED`.** Not for boot work:
  expo-task-manager persists its delivery jobs and Android crashes the process
  on the first fix without it (details and the stack in ADR 0008's amendment).
- **The foreground-service notification is invisible on API 33+** without the
  runtime notifications permission, which the app does not request. Recorded in
  ADR 0008; the decision whether to add that prompt is open. This also settles
  the Live Activity question left in item 1: expo-location's own service
  notification is the Android counterpart, and `live-activity`'s Android adapter
  stays a no-op.
- **`'unsupported'` stays in `LocationPermissionStatus`** but is no longer
  returned by any adapter; the banner and Settings branches keyed on it are dead
  on both platforms. Removing the member is a type-only cleanup for a later
  stage (it touches the iOS Settings record).
- **Android Settings gains a Location section** (Material rows: Access value,
  Open Settings / Enable location actions, explanatory supporting text) built on
  the cross-platform `useLocationPermission()`; the location primer onboarding
  step drops its `platforms: ['ios']`; `runHoldsScreenAwake` is back to
  `locked` everywhere and ADR 0008's 2026-09-20 amendment is closed.
- **`RunLocationBanner` needed the item-5 icon pair** (`location.slash` → `{ ios, android: 'location_off' }`): the banner never mounted on Android in stage 1, so the bare SF Symbol name only became a blank glyph once denial was reachable. The one shared component edit of the stage; a no-op on iOS.
- **Predictive back is enabled** (`android.predictiveBackGestureEnabled: true`,
  requested during the stage). React Native 0.86's `ReactActivity` registers an
  `OnBackPressedCallback` for the enforced predictive back of target SDK 36 and
  react-native-screens routes back through AndroidX's dispatcher, so JS
  `BackHandler` and expo-router pops keep working; verified by back-gesturing
  out of the run summary. Screens does not implement in-app predictive
  animations, so only the system-level (back-to-home) preview animates.
- **Emulator facts** that cost time, kept in AGENTS.md: a bare `android.*` or
  plugin-option change needs an explicit `prebuild:dev:android` before the
  Gradle build; the debug APK is ~340 MB and the emulator's data partition needs
  roughly twice that free, with failed installs leaving a copy in
  `/data/local/tmp`; after a permission reset (a force-stop) the `runbrodev://`
  link can resolve to another installed dev client, so launch by package first.

## Amendment (2026-09-21): stage 3 built — spoken cues over audio focus

Stage 3 shipped as planned and as decided: `cue-service/adapter.android.ts` is a
real expo-speech adapter, the composition seam, the release scheduler, the
engine and the iOS adapter are untouched, and the ducking mechanics are in ADR
0009's amendment of the same date. What the stage adds to this record:

- **The repo's first local native module, `modules/audio-focus/`** (Expo Modules
  API, Kotlin, ~60 lines, `platforms: ["android"]`, no config plugin).
  Autolinking discovers it from the default `modules/` directory; its TS wrapper
  is `index.android.ts`, reached through a new `@/modules/*` tsconfig path
  alias (beside `@/assets/*`) and imported only from `adapter.android.ts`, so the
  iOS TypeScript project and the iOS bundle never see it. The plan's iOS/web stub
  was unnecessary for the same reason. `modules/` is now where native code the
  app owns lives; `app.json` + config plugins remain the way to configure
  third-party native code.
- **The iOS fingerprint did not move for the module** (`9061ec14…` before and
  after it landed): an Android-only local module is not an iOS autolinking
  source, so this stage — unlike the plan's expectation — leaves iOS
  OTA-eligible. What *did* move it, briefly, was a Gradle-intermediates rule
  added to the root `.gitignore`: **the root `.gitignore` is itself an iOS
  fingerprint source** (`bareGitIgnore`), so any new rule there costs a release
  its OTA eligibility. The rule lives in `modules/audio-focus/android/.gitignore`
  instead, which is not in the iOS source set — verified back at `9061ec14…`.
- **Onboarding and copy:** `audio-cues-v1` dropped its `platforms: ['ios']`
  (Android: welcome → audio cues → location primer; `health-primer-v1` stays
  iOS-only); the audio-cues primer's "Over your music" sentence is the one
  shared-screen fork, a `Platform.select` ("Spotify or YouTube Music", no silent
  switch); Android Settings' cue section is "Coaching" with the iOS footer's
  wording split across the two rows, and the stage-1 "cues need the screen on"
  sentence is gone. The run banner's copy needed no change: its truth table
  (cues stop in the dark only when location is denied) now matches iOS.
- **One divergence from iOS in the adapter:** no release debounce, because React
  Native suspends JS timers while the activity is paused (measured and explained
  in ADR 0009's amendment). The scheduler's injectable timer seam carried it
  without a change to the scheduler.
- **Emulator facts** that cost time, for AGENTS.md: `adb install -r` on the
  built debug APK is a streamed install that stages one copy where Gradle's
  `installDebug` stages two — the way through when `/data` has under ~700 MB
  free; a `pm revoke` puts the app in the stopped state (relaunch by package);
  Settings gains an "Open Settings" row when location is denied, which shifts
  every row below it; another dev client launched on the same emulator mid-run
  takes the taps meant for this app; and argent boots emulators muted, so
  audibility needs `boot-device` with `sound: true`.
