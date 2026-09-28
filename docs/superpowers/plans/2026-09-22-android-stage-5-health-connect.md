# Android Stage 5 — Health Connect Handoff

> **For agentic workers:** this is a **handoff**, not yet a task-by-task plan. Stage 4 is built on `ll/android-stage-4` (PR #66, stacked on #65 → #63 → #62 → #61); branch this stage as `ll/android-stage-5` on top of it, in a worktree. Read, in this order: [ADR 0025](../../adr/0025-android-staged-migration.md) (stage table + all four 2026-09-21 amendments), [ADR 0011](../../adr/0011-apple-health-kingstinct-healthkit.md) **including its 2026-08-01 amendment** (the port contract and the two save-path traps), the iOS design spec [`2026-07-31-stage-5-apple-health-design.md`](../specs/2026-07-31-stage-5-apple-health-design.md) §4–§7 (the architecture Android reuses and the UI it mirrors), the iOS plan [`2026-08-01-stage-5-apple-health.md`](2026-08-01-stage-5-apple-health.md) Tasks 5–9 (the surfaces that come back on Android) and its privacy-policy text near the end, the [onboarding carousel design](../specs/2026-09-21-android-onboarding-carousel-design.md) §5 (the permission-step template and its §5.4 Health Connect note), the [stage 4 plan](2026-09-21-android-stage-4-maps.md)'s "As built" section, and the `android-stage-4` and `android-safe-area-insets` memories. Then write the task plan with the decisions below settled.

**Goal:** A finished Android run is written to Health Connect as a running exercise session carrying its duration, distance and GPS route — automatically when authorized, retryable from the summary when not, never blocking or endangering the local save — with the Health primer back in Android onboarding and a Health Connect section in Android Settings. iOS unchanged.

**Spec:** ADR 0025 row 5 ("`react-native-health-connect` behind `HealthAdapter` (ADR 0011); health onboarding step and Settings row return. Plugs in at `health/adapter.android.ts`; `health-status-row.android.tsx` stub goes."). ADR 0011 item 7 pre-approves the library and says the port was designed against both APIs' shapes — §2 below is where that claim meets reality.

## 1. What stage 4 decided that binds this stage

These are the choices from the maps stage (and the stages before it) that shape Health Connect. Each is already in force in the tree; do not re-decide them, work with them.

1. **The fingerprint strip in `fingerprint.config.js` is narrow and cannot be widened to cover this stage.** Stage 4 learned that the whole normalised Expo config is one `contents` source on **both** platforms, so a bare `android.*` field moves the iOS hash. It neutralised the Maps key by stripping exactly `android.config.googleMaps` from the `expoConfig` source (ADR 0012, 2026-09-21 amendment). That worked because a key is a manifest-only value JS never reads. Health Connect needs `react-native-health-connect` in `plugins` (its `app.plugin.js` is also an `expoConfigPlugins` *file* source), the health permissions in `android.permissions`, and possibly `expo-build-properties` for `minSdkVersion: 26` — all genuinely native-affecting for Android. The hook is **platform-blind** (it sees the source, not which platform's fingerprint is being computed), so stripping those would also strip them from the *Android* hash and manufacture exactly the silent OTA-compatibility bug ADR 0012 forbids. **Expect the iOS hash to move in this stage, on purpose**, and treat it as a batching decision (Decision 1). Measure before and after every task as stage 4 did: `APP_VARIANT=development bunx expo-updates fingerprint:generate --platform ios | jq -r .hash` (stage-4 tip: `99862a79…`; variant-less `9061ec14…`).
2. **"Degrades gracefully" claims get measured, not believed.** Stage 4's plan said a missing Maps key would show grey tiles; it crashed the app, and the fix (a placeholder key) came from measuring the absent, invalid and valid states separately. Do the same here for Health Connect's three non-authorized states — SDK unavailable, provider update required, permission denied — before writing the degradation copy.
3. **The health seam is already platform-blind and running on Android.** `withHealthSync` wraps the persistence at the composition root (`run-engine/index.ts`), `syncRunToHealth` + `isHealthWritable` gate the write (finalized run, not a field-test capture, not already saved), `useHealthAuthorization` re-reads on AppState and on the seam's `notifyAuthorizationChanged`, and the stub adapter returns `'unavailable'` so every consumer already renders "not available". Stage 5 is an adapter swap plus the two UI forks — the shared code should not need to learn anything.
4. **The `runs.healthkit_saved` column keeps its name.** It is the sync-agnostic "written to the platform health store" flag (ADR 0004); renaming it is a migration for no behaviour. The Android adapter sets the same flag.
5. **Forks live at the component seam; shared code stays platform-blind** (ADR 0025 §2). `health-status-row.android.tsx` becomes a real RN + Uniwind row (the iOS one is `@expo/ui` `Island.Button` + `Card`), the Android Settings route (`(tabs)/settings/index.android.tsx`, a Compose `LazyColumn`) gains a section, and `onboarding/health.tsx` — currently shared but with Apple copy ("Your runs, in Apple Health", "Connect Apple Health") — needs either an `.android.tsx` fork or `Platform.select` for the two strings (the audio-cues primer's "Over your music" sentence is the precedent for a one-sentence `Platform.select`; a whole-screen copy change is a fork). `expo-symbols` names stay `{ ios, android }` pairs (`favorite` is already there for the heart).
6. **Android scrolling screens pad the content container by the safe-area inset.** The summary's `ScrollView` now carries `android:pb-safe-offset-10`; the Health row is the **last card** on that screen, so it is the first thing to check scrolled to the bottom (AGENTS.md platform-forks bullet; the `android-safe-area-insets` memory has why this keeps being missed).
7. **The emulator is shared and its storage is tight.** ~620 MB free fails even `adb install -r` of the 337 MB debug APK; the way through is the uninstall → install → restore recipe in ADR 0025's stage-4 amendment (back up `files/SQLite/*` with `run-as`, push back before first launch, `pm grant` location again). **A reinstall also clears the app's Health Connect grants**, which live in the platform controller, not the app — re-grant through the Health Connect UI after every reinstall. Lukas's other dev client may be in the foreground mid-test; re-`describe` before every tap after a pause, and ask before taking the screen if his app is active.
8. **The Maps key must travel with the worktree.** `.env.local` is gitignored, so a fresh stage-5 worktree prebuilds with the `MISSING_GOOGLE_MAPS_ANDROID_API_KEY` placeholder and every summary shows a blank map card. First thing after `git worktree add`: `cp /Users/lukas/my-runner/.env.local .` — never commit it, never paste the key into a conversation.
9. **Three fixture runs exist on the emulator** for the summary's "save this run" button and the auto-save path: `5356c176…` (0.67 km, warm-up only), the 0.47 km run with run/walk segments, and `b29bc8c5…` (52 m, no route). A geo-fed real-plan run with the warm-up skipped gives run/walk segments in ~3 minutes; feed *before* Start.

## 2. Verified facts about the library and the device (2026-09-22, in the tarball and on the emulator — re-check on a bump)

- **`react-native-health-connect@4.1.3`** (published 2026-08-06): `peerDependencies` `expo: *`, `@expo/config-plugins >= 6.0.2`. **No `ios/` directory** in the tarball and `expo-module.config.json` declares `"platforms": ["android"]`, so the package itself is **not an iOS autolinking source**; only the `plugins` entry and its `app.plugin.js` reach the iOS fingerprint (via `expoConfig` / `expoConfigPlugins`). Install with `bun expo install react-native-health-connect` — Bun owns `bun.lock`; the guard hook refuses hand edits to it.
- **As of v4 the Expo integration is bundled**: an `android-expo/` Expo module registers the permission-contract delegate, so `MainActivity` is never touched; the deprecated `expo-health-connect` must **not** be installed alongside (duplicate `HealthConnectPackage` class).
- **What its config plugin does — and does not do.** `app.plugin.js` only adds the permission-rationale plumbing: an `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` intent-filter on `MainActivity` (Android ≤ 13) and a `ViewPermissionUsageActivity` activity-alias guarded by `START_VIEW_PERMISSION_USAGE` with the `VIEW_PERMISSION_USAGE` / `HEALTH_PERMISSIONS` intent-filter (Android 14+). **It does not declare any health permission** — those go in `android.permissions` in `app.json` (verify the exact strings against the Health Connect docs before writing them; the write-only set this stage needs is exercise, exercise route and distance). Both are bare `android.*` config changes: `bun run prebuild:dev:android` + a Gradle build, or nothing changes.
- **The README asks for `expo-build-properties` with `minSdkVersion: 26`.** Check what the SDK 57 template already sets before adding another plugin (each plugin entry is a fingerprint source); if the current minSdk is ≥ 26 the plugin is unnecessary.
- **Health Connect is part of the platform on the emulator.** `emulator-5554` runs **Android 16** and ships `com.google.android.healthconnect.controller` and `com.google.android.health.connect.backuprestore`; there is no separate Play-store provider to install or update. The absent / update-required SDK states therefore need a different device (or a mocked adapter answer) to observe — measure what you can here and say which state was not exercised.
- **The rationale intent lands on `MainActivity` with no URL.** When Health Connect's permission dialog's privacy link fires, expo-router receives the app's own activity intent, not a deep link. What the user then sees is unverified — Decision 3 below. The iOS plan's "RunBro does not collect your data" text near its end is the privacy copy to reuse; Play's health-app declaration (stage 7) will also want it at a URL.
- **Argent drives the Health Connect permission UI**: it is a normal system activity (`describe` sees it), unlike iOS's `HealthPrivacyService` remote view controller. Whether `pm grant se.lukaslindqvist.runbro.dev android.permission.health.WRITE_EXERCISE` pre-grants a health permission on this image is **unverified** — try it once; if it works it shortens every reinstall.

## 3. Where the iOS port contract and Health Connect disagree

ADR 0011 item 7 says the port "was designed against both APIs' shapes". Three places where that is not quite true, each a decision for the plan:

1. **`getAuthorization()` is synchronous by contract** ("Synchronous, because the underlying HealthKit call is" — `port.ts`), and `syncRunToHealth` and `useHealthAuthorization`'s `useState` initializer both call it synchronously. Health Connect's `getSdkStatus` and `getGrantedPermissions` are async. Options: (A) keep the port synchronous and have the Android adapter **cache** the status — probe on module load and after every `requestWriteAccess`, and expose a refresh the hook can trigger on AppState `active` (today the hook re-reads synchronously; a cached value is stale until the next probe resolves, so the adapter must call `notifyAuthorizationChanged` when a probe changes the answer — mind the import cycle with `use-health-authorization.ts`); (B) make the port async and update the iOS adapter, `sync.ts` and the hook — honest for both platforms but touches iOS files and the hook's first render (a `notDetermined` flash the Maestro anchors would see). **Recommended: A**, per the stages' "iOS untouched" rule; record it as an ADR 0011 amendment either way.
2. **`domain/health.ts` is Apple-shaped.** `toHealthRoute` fills unknown accuracy/speed/course with `CL_UNKNOWN = -1` because CoreLocation reads negative as "not measured". Health Connect's route location takes optional accuracy/altitude fields and validates lengths as non-negative — a `-1` sentinel is an exception, not "unknown". The Android adapter must translate `HealthWorkoutInput` (drop `-1` fields, keep altitude/accuracy only when known) rather than pass the Apple payload through. Put that translation in a **pure, `bun test`-ed helper** (domain or a `health/` module with no RN imports) so the port stays unchanged and the mapping is tested like `toHealthRoute` is.
3. **Idempotent retries use a different mechanism.** iOS relies on `HKSyncIdentifier` + a `Date.now()` `HKSyncVersion` (ADR 0011 amendment item 6). Health Connect's analogue is `clientRecordId` (the run id) + a monotonically increasing `clientRecordVersion` on the record metadata — an insert with a repeated client id and a higher version updates instead of duplicating. Same contract, different keys; verify the exact field names in the library's record types (`src/types/`), and keep `Date.now()` as the version for the same reason iOS does.

Also on the mapping: iOS writes one workout + one whole-session distance sample (amendment item 7, after per-segment samples fragmented the user's history). Health Connect's equivalent is one `ExerciseSession` (type running, with the route attached) plus one `Distance` record spanning the session — keep the same "no per-segment samples" stance; the app's DB stays the source of truth for intervals.

## 4. Decisions for Lukas (settle before the plan is written)

1. **The iOS fingerprint move.** (A, recommended) Accept it and **batch** this stage's config with the other pending both-platform native change — the `expo-image`-based fixed-size start/finish icons stage 4 deferred (ADR 0010 Android amendment item 3/6) — so one iOS native release carries both, then record the new iOS baseline in ADR 0012's amendment. (B) Ship stage 5 alone and take the iOS native release for it. (C) Try to keep iOS neutral by moving the health permissions into the library plugin's mod instead of `android.permissions` — does not help: the `plugins` entry and the plugin file move the hash regardless.
2. **Sync vs async `getAuthorization`.** §3.1 — A (cached, Android-only) recommended; B (async port) if Lukas prefers the honest contract and accepts touching iOS files.
3. **The rationale / privacy route.** Health Connect opens the app for the permission rationale (Android 14+: via the activity alias). Options: (A, recommended) a small `privacy` route (RN + Uniwind, shared copy from the iOS plan's privacy text) that the rationale intent opens and that Settings also links to — doubles as the privacy-policy page stage 7 needs a URL for; (B) rely on the app opening at its root and put the copy only in Settings.
4. **Settings row form.** iOS shows a *reporting* row because HealthKit never lets an app revoke its own grant. Health Connect **does** expose `revokeAllPermissions()`, so a real on/off switch is possible on Android. (A, recommended) mirror iOS — a status row plus "Set up" / "Open Health Connect" (`openHealthConnectSettings()` from the library replaces `x-apple-health://`) — because a switch that revokes *all* grants can't be undone in-app without re-prompting and the two platforms should read the same; (B) a real Material switch that requests / revokes.
5. **Copy.** "Health Connect" everywhere Android says "Apple Health" (primer headline, CTA "Connect Health Connect", Settings section title, the row's "Saved to Health Connect"); §5.4 of the carousel design wants the primer to list the data types written (exercise session, distance, route) in its three rows and to follow education → consent → request. Decide whether the primer's three rows are shared with iOS or forked.

## 5. Suggested task order (for the plan)

Config and dependency first (`bun expo install`, plugin, permissions, prebuild, Gradle, **measure both fingerprints and record the move**), then the pure mapping helper with tests, then the adapter (probe/cache, request, save with client-record idempotency), then the three UI surfaces (summary row, Settings section, primer + `platforms` drop — with the onboarding unit test's Android expectation updated to `welcome → audio-cues → health → location-primer` or whatever order is decided), then verification on the emulator (auto-save after a fed run → Health Connect app shows the session with route and distance; manual save of an older fixture; denied and undetermined paths; the rationale route; reinstall → grants cleared → row degrades), then docs (ADR 0011 Android amendment, ADR 0012 new baseline, ADR 0025 row 5 + amendment, AGENTS.md state line and Maps-bullet-style Health Connect facts, memory).

## 6. Gates and traps carried forward

- Objective gate per task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`. Metro on **8087**; `APP_VARIANT=development`; `export COREPACK_ENABLE_AUTO_PIN=0`; never touch `bun.lock` by hand, `CHANGELOG.md`, `version`.
- Comments WHY-only; architecture in ADRs (`// per ADR 0011 §4`). Run `adr-compliance-reviewer` and `comment-density-auditor` before the PR — stage 4's ADR review caught a rule (ADR 0019 "identity only") the code had outgrown; expect ADR 0011's "designed against both APIs' shapes" to need the same honesty.
- Worktree-guard quirks: a Bash command that mixes a heredoc with `git`, or a shell variable feeding `adb`/`tar`, is refused — split into plain commands or use the Edit tool. Metro's log piped through `head` is empty (buffering): read logcat. A fresh dev-client install shows a developer-menu sheet whose "Continue" opens the full menu — press back. `await-ui-element` on `TOOLS` matches the floating "Tools" button. When two devices share port 8087 the debugger attaches by Metro's logical id.
- Verification is on the shared `emulator-5554` (Pixel 9 Pro, Android 16) with argent; stop its servers (`stop-all-simulator-servers` scoped to the device) when done. Maestro on Android is stage 7.

---

## 7. Decisions (settled 2026-09-22)

All four went with the recommended option. §5 (copy) was settled by the executor
under the handoff's own rules:

1. **iOS fingerprint:** accept the move, record the new baseline in ADR 0012.
   Release batching with the deferred `expo-image` icons stays a separate PR.
2. **`getAuthorization()` stays synchronous;** the Android adapter caches a
   probed status and refreshes it on module load, after every request and on
   AppState `active`, notifying the hook when the answer changes. The listener
   `Set` moves to `authorization-events.ts` so the adapter can import it without
   a cycle; the hook module re-exports it for its existing callers and tests.
3. **A `privacy` route** (RN + Uniwind, shared copy) linked from Android Settings
   and opened by Health Connect's rationale intent through a ~30-line
   Android-only local module, `modules/launch-intent/`, mounted as a
   `HealthRationaleGate` beside `ResumeRunGate` (its iOS fork renders nothing).
4. **Settings mirrors iOS:** a reporting "Access" row plus *Set up Health
   Connect* (undetermined) / *Open Health Connect* (denied), following Google's
   own advice against `revokeAllPermissions()` switches.
5. **Copy:** "Health Connect" everywhere Android says "Apple Health". The primer
   and the summary row are `.android.tsx` forks (whole-screen copy changes),
   the primer's rows name the three data types written (§5.4). Step order is
   the shared one (welcome → audio cues → location → health) — one ordered list
   serves both platforms and health reads naturally after location.

Two library facts found while planning, both load-bearing for the mapping:
`ReactExerciseSessionRecord.parseWriteRecord` calls `getLengthFromJsMap` on all
three route `Length` fields and **throws `InvalidLength` when one is absent**,
so the TS `?` on `Location.horizontalAccuracy/verticalAccuracy/altitude` is a
lie for writes — every point must carry all three; and the `connect-client`
constructor requires route times to satisfy `start ≤ t < end` and be strictly
increasing (`ExerciseSessionRecord.kt`, `ExerciseRoute.kt`), so the mapper
filters to the window and drops duplicate timestamps. Android's own `Location`
API reports an unavailable accuracy as `0`, so that is the value used for a
`CL_UNKNOWN` field — Health Connect rejects negatives.

## 8. Task plan

Gate after every task: `bun run lint && bun run typecheck && bun run typecheck:android && bun test`.

### Task 1: Dependency, permissions, minSdk 26, prebuild, Gradle, fingerprints
- `bun expo install react-native-health-connect expo-build-properties`.
- `app.json`: `plugins` += `"react-native-health-connect"` and
  `["expo-build-properties", { "android": { "minSdkVersion": 26 } }]` (SDK 57's
  default is 24 via `ExpoRootProjectPlugin.kt`; `connect-client:1.1.0` needs 26);
  `android.permissions` += `android.permission.health.WRITE_EXERCISE`,
  `android.permission.health.WRITE_EXERCISE_ROUTE`, `android.permission.health.WRITE_DISTANCE`.
- `bun run prebuild:dev:android`, then `cd android && APP_VARIANT=development ./gradlew :app:assembleDebug`.
- Record iOS (dev `99862a79…`, variant-less `9061ec14…`) and Android (`a222c043…`) hashes before/after.

### Task 2: Pure Health Connect mapping — `src/services/health/health-connect.ts` (+ `.test.ts`)
- `toExerciseRouteLocations(input)`, `toExerciseSessionRecord(input, version)`,
  `toDistanceRecord(input, version)`, `resolveAuthorization({ sdkAvailable, granted, requested })`.
- Type-only imports from `react-native-health-connect`; numeric constants local (bun cannot load the library's runtime entry).

### Task 3: `authorization-events.ts` + `adapter.android.ts`
- Cached status, probe on load / AppState / after request; `requested` flag in `expo-sqlite/kv-store` (`health.writeAccessRequested`).
- `saveRun`: `initialize()` → `insertRecords([session])` → `insertRecords([distance])`, `clientRecordVersion = Date.now()`.

### Task 4: `open-health-app.android.ts` → `openHealthConnectSettings()`, `Linking.openSettings()` fallback.

### Task 5: `modules/launch-intent/` + `HealthRationaleGate` + `privacy` route
- Kotlin: `Function("getAction")`, `OnNewIntent` → `sendEvent("onIntent", { action })`.
- `src/components/health-rationale-gate.android.tsx` pushes `/privacy` for
  `androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE` / `android.intent.action.VIEW_PERMISSION_USAGE`; `.tsx` renders null.
- `src/app/privacy.tsx` composes `PrivacyPolicy` (`src/components/privacy-policy.tsx`); registered in the root Stack as a modal.

### Task 6: UI forks
- `health-status-row.android.tsx` (real row), Settings "Health Connect" section + "Privacy policy" row,
  `onboarding/health.android.tsx`, `onboarding.ts` drops `platforms: ['ios']`, `onboarding.test.ts` Android expectation gains `health-primer-v1`.

### Task 7: Emulator verification (adb-driven; argent MCP failed to connect this session)
- Reinstall recipe (storage ~640 MB free), grant, onboarding primer → Health Connect dialog → grant → Settings reports *Saving workouts*;
  manual save of a fixture → session + distance + route visible in Health Connect; retry idempotency; denied path; rationale link → privacy route; reinstall → grants cleared.

### Task 8: Docs — ADR 0011 Android amendment, ADR 0012 new baseline, ADR 0025 row 5 + amendment, AGENTS.md, `docs/privacy-policy.md`, this plan's "As built", memory.

---

## As built (2026-09-22) — read before the next stage

Shipped on `ll/android-stage-5`, stacked on #66. All four decisions went with
the recommended option (§7). The record of what was verified and what deviated
lives in ADR 0011's, ADR 0012's and ADR 0025's 2026-09-22 amendments; the
short version:

- **The port stayed synchronous; the Android adapter caches a probed status**
  (module load, after each request, AppState `active`) and notifies the hook
  through `authorization-events.ts`, which the hook module re-exports.
- **The library's route writer requires all three `Length` fields** despite the
  optional types, and Health Connect requires `start ≤ t < end` with strictly
  increasing times — `health/health-connect.ts` (pure, 16 tests) does the
  filtering and writes unknown accuracy as `0` m.
- **The rationale link cancels the dialog.** Found by verification: tapping
  "privacy policy" in Health Connect's dialog relaunched the single-task
  activity, the request resolved empty, and the first build marked the user
  denied and advanced the primer. Fixed in the adapter (an empty result that
  coincides with the rationale intent, allowing 1 s, stays undetermined) and
  the Android primer (stays for an undetermined answer). Retested end to end.
- **Idempotent retries verified for real** (the half iOS could not verify):
  saving the fixture twice left one session and one distance entry.
- **Auto-save verified** on a fresh 40-second compressed finish: session with
  route, no distance record for 0 m, `healthkit_saved = 1`.
- **`pm grant` / `pm revoke` work for the health permissions**, so a reinstall
  no longer needs the Health Connect UI; `MANAGE_HEALTH_DATA` is the intent that
  shows what was written.
- **Fingerprints:** iOS dev `99862a79… → cbccdd29…`, variant-less
  `9061ec14… → 7daa9686…`, Android dev `a222c043… → aa17e5a5…` — deliberate,
  recorded in ADR 0012.
- **Not exercised:** `SDK_UNAVAILABLE` / provider-update-required (platform
  Health Connect on Android 16), an explicit *Don't allow*, the twice-cancelled
  auto-decline, and a reinstall's grant wipe (the `pm` route makes it moot).
- **Open:** the Android primers' hero symbol sits under the status bar (a
  pre-existing layout of the shared `OnboardingStepScreen` on Android, owned by
  the carousel redesign spec); Maestro on Android remains stage 7.

Handoff for stage 6 (elevation): not yet written.
