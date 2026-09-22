# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. This project uses Expo SDK 57, React Native 0.86, React 19.2, and TypeScript ~6.0 — newer than most training data. Do not rely on memorized Expo/React Native APIs.

# What this app is

A free Couch-to-5K mobile app: it guides someone who can barely run through a progressive walk/run program until they can run 5 km. Inspired by paid App Store equivalents, but free.

Hard constraints:
- **No backend, no accounts, no analytics.** All data lives on-device, with iCloud as the only sync/backup mechanism.
- iOS first, Android in stages: `platforms: ["ios", "android"]`. iOS is the full app (HIG, SwiftUI islands, iCloud backup). Android ships stage by stage per [ADR 0025](docs/adr/0025-android-staged-migration.md) — stages 1 (all plan weeks, clock + vibration cues), 2 (foreground-service location: distance, pace, screen-off heartbeat) 3 (spoken cues over audio focus via the local `modules/audio-focus/` module) and 4 (Google Maps route card and viewer; needs the Maps key in `.env.local`, see "Maps" below) are built; no Health/elevation yet; the ADR's stage table says what is live. The two apps are deliberately not a 1:1 design: Material 3 with Jetpack Compose islands on Android, dynamic (wallpaper) colour. There is no web target — react-native-web has been removed.

# Commands

This project uses **Bun** as its package manager and script runner — `bun.lock` is the only lockfile, and Expo CLI/EAS Build auto-detect Bun from it. Metro and the dev server still run on Node (keep a Node LTS installed); Bun handles installing and launching.

> **corepack gotcha:** with corepack auto-pin on (the default), running any Expo command (`bun expo …`, `bunx expo-doctor`) makes corepack write a spurious `"packageManager": "yarn@…"` field into `package.json`. This repo is Bun-only — **never commit that field**: a committed `packageManager: yarn` can make EAS Build / the CI `e2e-ios` job honor Yarn over `bun.lock` and break the build. Prevent it with `export COREPACK_ENABLE_AUTO_PIN=0` in your shell; if the field appears, delete it before committing.

- `bun install` — install dependencies (`bun ci` for a frozen, reproducible install)
- `bun expo install <package>` — add a dependency at the Expo SDK-compatible version (use this instead of `bun add` for anything Expo touches)
- `bun run start` — `expo run:ios`: compile and install the iOS dev-client build and start the Metro dev server. Required on first run and after any native change (new native dependency, config plugin, native app.json fields). The app uses expo-dev-client, not Expo Go. To start Metro only — when the app is already installed, or you just need typed routes regenerated — run `bun expo start` directly. **Prebuild gotcha:** `expo run:ios` only re-runs prebuild when `ios/` is absent — a bare native `app.json` *field* change (unlike a new dependency or config plugin) against an already-generated `ios/` silently does nothing until you run `bun run prebuild:dev` (or `--clean`) explicitly.
- `bun run android` — `expo run:android --port 8087`: Gradle-build and install the Android dev client (`se.lukaslindqvist.runbro.dev`) on the running emulator and start Metro on **8087** (8081/8082 are the owner's other dev servers). First build ≈ 10 min; `bun run prebuild:dev:android` regenerates `android/` (gitignored, like `ios/`). Re-enter the app after a `restart-app` with `open-url` on `runbrodev://expo-development-client/?url=http://localhost:8087` (`adb reverse tcp:8087 tcp:8087` is set up by the run script; re-run it if the emulator restarts). **A local Android build dirties the iOS fingerprint** — see "Dependency drift" below before an `eas build --local -p ios`. **Native config gotcha:** a plugin option or bare `android.*` field change (e.g. the expo-location foreground-service keys, `android.permissions`, `predictiveBackGestureEnabled`) does nothing until `bun run prebuild:dev:android` re-runs — `expo run:android` reuses an existing `android/`; with Metro already up, rebuild with `cd android && APP_VARIANT=development ./gradlew :app:installDebug`. **Emulator storage:** the debug APK is ~340 MB and an install needs roughly twice that free on `/data`; a failed install (`INSTALL_FAILED_INSUFFICIENT_STORAGE` / "Requested internal only, but not enough space") leaves a full copy in `/data/local/tmp/app-debug.apk` — delete it, and uninstall the app before reinstalling if still short. **Stopped-state gotcha:** a permission reset or force-stop puts the app in Android's stopped state, and the `runbrodev://` deep link then resolves to whatever other dev client is installed — `launch-app` by package first, then `open-url`. **Moving the emulator:** `adb -s emulator-5554 emu geo fix <lon> <lat>` (longitude first) once per second, stepping latitude by 0.000025° ≈ 2.8 m/s; screen-off runs are `adb shell input keyevent KEYCODE_SLEEP` / `KEYCODE_WAKEUP`, and the evidence is the run's `run_log` (`fix_batch`, `tick`, `cue`, `lifecycle` rows), readable off the debug build with `adb exec-out run-as se.lukaslindqvist.runbro.dev cat files/SQLite/runbro.db` (plus the `-wal` and `-shm` files) and `sqlite3`. Maestro on Android is stage 7 and has not been run against this app; ADR 0001's finding that Maestro cannot drive GPS *motion* is expected to hold there too (its Android driver also loops `setLocation`) but is unverified. **Spoken-cue evidence (stage 3):** argent boots emulators muted — pass `sound: true` (with `force: true`, a cold boot) to `boot-device` to hear cues; objective evidence needs no sound: `adb shell dumpsys audio | grep -A3 'Audio Focus stack'` lists the app's `GAIN_TRANSIENT_MAY_DUCK` entry while a cue speaks, `adb logcat -s MediaFocusControl` logs every `requestAudioFocus`/`abandonAudioFocus` with our `USAGE_ASSISTANCE_NAVIGATION_GUIDANCE` attributes, and utterance playback shows as `AudioTrack … stop()` lines from the Google TTS process — pair them with the run's `cue` rows. **Tight storage:** `adb -s emulator-5554 install -r android/app/build/outputs/apk/debug/app-debug.apk` is a streamed install that stages one copy where Gradle's `installDebug` stages two; use it after a successful build when `/data` is under ~700 MB free.
- `bun run lint` — `expo lint` against the committed `eslint.config.js` (ADR 0014: includes Prettier formatting + Uniwind class sorting as lint errors, and type-aware `no-floating-promises` in `src/`; `bun run lint --fix` auto-formats). The class sorter reads the app's `@theme` out of `node_modules/uniwind/uniwind.css`, which **Metro rewrites in place** — a fresh install only ships a stub, so before Metro has run the custom `bg-background-*`/`text-foreground-*` tokens sort as *unknown* classes (hoisted to the front of the `className`) and lint disagrees with a warm checkout. Regenerate without booting Metro via `bunx uniwind generate-artifacts --css ./src/global.css --dts ./src/uniwind-types.d.ts` (the flags mirror `metro.config.js`; CI does this in the `checks` job).
- `bun test` — runs the unit suites (pure-TS `domain/` and `services/`; no RN runtime needed). Two gotchas from the barometer field-logging slice: **any module reachable from `bun test` must import no Expo or React Native package** — importing `expo-crypto` (or anything else pulling in `react-native`) crashes Bun's parser on `react-native`'s Flow-syntax entry point the instant that module loads, which is why `PROCESS_TOKEN` (`src/services/run-engine/run-log.ts`) doesn't use `expo-crypto`'s `randomUUID()`, and why the `src/db/` readers stay untestable. And **`mock.module` is global for the whole `bun test` run, not scoped to the file that calls it** — two test files mocking the same specifier fight over it, and whichever runs second sees the shape the first one's mock left behind, missing exports it expected.
- `bun run typecheck` / `bun run typecheck:android` — `tsc --noEmit` against `tsconfig.json` (iOS anchor, excludes `**/*.android.*`) and `tsconfig.android.json` (Android anchor, excludes `**/*.ios.*` and the three SwiftUI route fallbacks). Every file is in exactly one project (ADR 0003's 2026-09-20 amendment); CI runs both. `bun run typecheck` depends on two **gitignored generated files**: `expo-env.d.ts` and `.expo/types/router.d.ts` (typed routes). In a fresh clone or worktree it fails (`TS2882` on `@/global.css`, then route-typing errors) until you start the dev server once — `bun expo start` on any free port, kill it as soon as `.expo/types/router.d.ts` appears. Never copy `.expo/types/router.d.ts` from another checkout: it encodes that branch's route files and produces misleading type errors on this one.
- `bun run db:generate` — regenerates Drizzle migrations after editing `src/db/schema.ts` (commit the generated output)
- `bun run e2e` — run the full Maestro E2E suite against the `e2e-simulator` build on a booted simulator (`bun run e2e:onboarding` / `bun run e2e:session` for tagged subsets; `bun run e2e:build` to produce the `e2e-simulator` app via `eas build --local`, into `build/`). See "E2E tests (Maestro)" below.
- `bunx expo-doctor` — SDK/dependency alignment and config sanity. **Deliberately not a CI check** and deliberately not a `package.json` script (adding one would change the native fingerprint). Run it by hand when bumping native dependencies or upgrading the SDK, and treat its version-drift finding as a batching decision, not a chore — see "Dependency drift" below.

`.github/workflows/ci.yml` (the `checks` job) runs both typechecks, lint and unit tests on every PR. Each gates on the install step rather than on its predecessor, so one run reports every failure instead of stopping at the first.

The `/ios` and `/android` folders are gitignored — both are generated via prebuild (Continuous Native Generation). Never edit native projects directly; configure third-party native code through `app.json` and config plugins, and put native code the app owns in a local Expo module under `modules/` (`modules/audio-focus/`, Android-only, is the first — ADR 0025's stage-3 amendment; autolinking picks it up from that directory, and its TS wrapper is imported via the `@/modules/*` alias).

# Dependency drift

`expo-doctor` is **not** in `checks`, by design. Its expected-version table is fetched from `api.expo.dev` at run time, so an upstream SDK patch reddens a PR that changed nothing — and the only way back to green is bumping native packages, which changes the fingerprint and costs the next release its OTA eligibility (ADR 0012). It runs weekly in `.github/workflows/dependency-drift.yml` instead, which opens/updates a single `dependency-drift` issue and closes it when doctor is clean; `workflow_dispatch` triggers it on demand.

When acting on a drift report, sort the packages first — this is the whole point of the split:

- **A package with an `ios/` directory is a fingerprint source** (verified: the hashed set is each autolinked module's native dir, plus the autolinking configs, `expoConfig`, `react-native`'s `package.json`, and `packageJson:scripts`). Bumping one forces the next release through build → approval → store submit.
- **JS-only packages are free** — `clsx`, `tailwind-merge`, `drizzle-orm`, `victory-native`, `uniwind` and friends are not hashed at all.
- Compare hashes before and after with `bunx expo-updates fingerprint:generate --platform ios | jq -r .hash`.
- `expo.install.exclude` in `package.json` pins a package against the check, and is itself fingerprint-neutral (only the `scripts` field is hashed).
- **A local Gradle build pollutes the iOS fingerprint** (ADR 0020's mechanism, re-measured for ADR 0025 item 8): after `bun run android`, the iOS hash moved on exactly one source, the whole-package directory of `@react-native-masked-view/masked-view`, because AGP 8 rewrites its manifest in place (deletes the legacy `package=` attribute). `fingerprint.config.js` now hashes manifests without that attribute (a `fileHookTransform`), so pristine and Gradle-touched trees hash the same — keep that hook. If the hash ever drifts again after an Android build, diff `bunx expo-updates fingerprint:generate --platform ios` sources before and after `rm -rf node_modules && bun ci` to find the new mutation, then extend the hook rather than reinstalling forever. **The root `.gitignore` is a fingerprint source too** (`bareGitIgnore`, both platforms): a new ignore rule there moves the hash exactly like a native change would. Put directory-scoped rules in a nested `.gitignore` next to what they ignore (`modules/audio-focus/android/.gitignore` is the precedent) and keep the root file for repo-wide rules. The whole normalised Expo config is a source as well (`expoConfig`, hashed sorted), so a bare `android.*` field change moves the **iOS** hash — the stage-4 plan has the measured case and the hook that neutralises it.

# Skills & MCP — what to load when

Load the matching skill (Skill tool) BEFORE starting the work it covers. MCP servers are configured in `.mcp.json` (argent, maestro).

- **All on-device/simulator work goes through Argent** — `.claude/rules/argent.md` has the full skill-routing table. Implementation is iterated agentically on the iOS simulator and, for Android stages, the emulator (`emulator-5554`, Pixel 9 Pro API 36; argent's `describe` reads Compose islands as merged rows like `"Day 1 / Up next / 29 min"`, and its synthetic long-press does not register on Android — use `adb shell input swipe x y x y 1500` for a hold): make a change → run the app → drive and verify it with argent tools. Any change affecting visible UI, navigation, layout, or copy must be verified on the simulator this way before it's considered done. Typical loads: `argent-ios-simulator-setup` (boot, UDID), `argent-react-native-app-workflow` (run the app, Metro, builds, logs), `argent-device-interact` (tap/type/screenshot), `argent-test-ui-flow` (QA loops), `argent-react-native-profiler` / `argent-react-native-optimization` (performance).
- **Argent's `describe` DOES see this app's SwiftUI screens (corrected 2026-08-01).** This bullet previously said argent was blind to them and that discovery had to go through Maestro. Re-tested directly on iOS 26.5 with argent 0.17.0: `describe` returns the full tree with usable normalized frames for the pure-`@expo/ui` screens — Settings came back with `AXButton "Set Up Apple Health"` and the merged `AXStaticText "Access, Not Set Up"`, Plan with `AXButton "Day 1, up next, 1 min" id="plan-next-w1d1"`, testIDs included — and taps derived from those frames land. So argent is usable for interactive discovery and driving, not only `screenshot` / `launch-app` / `open-url` / `boot-device` / Metro / profiling. Three caveats: the sibling tools (`native-describe-screen`, `native-find-views`, `debugger-component-tree`) were **not** re-tested and may still be empty; tab-bar `AXButton` frames extend into the home-indicator zone, so the frame centre can miss the control and background the app — aim at the icon's own frame; and none of this changes E2E authoring, where Maestro's `inspect_screen` plus ADR 0016's text-first selectors remain the rule, since flows must not depend on frames. Stop argent's servers before running Maestro (`stop-all-simulator-servers`); see the Tool split below for why. Verifying against the **dev client** (`se.lukaslindqvist.runbro.dev`) is fine for interactive checks and needs no e2e build — but note `restart-app` drops you at the dev-client launcher, not the app; get back in with `open-url` on `runbrodev://expo-development-client/?url=http://<lan-ip>:8081`.
- **`react-native-best-practices`** — load before writing or editing any `.tsx` / React Native component code (re-renders, lists, animations, JS-thread work). Applies to all UI implementation, not only perf-labelled tasks.
- **Expo plugin skills** (from `expo@claude-plugins-official`, enabled in `.claude/settings.json`): `expo-app-design:building-native-ui` when building screens/navigation/UI with expo-router; `expo-app-design:expo-dev-client` when producing dev-client builds; `upgrading-expo` for SDK upgrades; `expo-deployment:expo-cicd-workflows` when writing `.eas/workflows/` YAML (the release-deploy pipeline — ADR 0012; the E2E CI gate is GitHub Actions per ADR 0001). Do NOT use `expo-app-design:expo-tailwind-setup` — styling here is Uniwind (ADR 0002), not NativeWind.
- **Docs lookup:** use the Context7 MCP (`resolve-library-id` → `query-docs`) for Expo SDK 57 / React Native / library APIs — see "Expo HAS CHANGED" above. Prefer it over memory and over web search.
- **Exception — `@kingstinct/react-native-healthkit`:** do not use Context7 for it. Its pages are generated `_autodocs` that describe an API present in neither the release nor `master`. Verify against the tarball (`npm pack`) and see ADR 0011's 2026-08-01 amendment.
- **Maestro MCP** — scripted E2E regression flows only; see "E2E tests (Maestro)" for the Maestro-vs-argent split.
- **`e2e-refresh`** — load before running any Maestro flow. It fingerprint-gates the rebuild (repack ≈ 1 min against a full build's 15–20) and proves the install actually landed. Targeted flows only; see "E2E tests (Maestro)" for what stays with CI. Two traps worth knowing before you rely on the gate: **only `bun run e2e:build` may record a fingerprint** — it stamps `build/.e2e-fingerprint` after a successful build, and the refresh script deliberately does *not* stamp when it merely extracts a tarball, because stamping the current tree's hash onto an older binary made the gate report a match and then repack onto a shell missing a native module (it crashed at import with `Cannot find native module …`, not as a test failure). An unstamped `.app` now fails closed. And **editing any `package.json` script changes the native fingerprint** — `fingerprint.config.js` only skips the `android`/`ios` script entries — so a one-line script edit invalidates a cached `e2e-simulator` build and costs the next run a full rebuild.
- **Review subagents** in `.claude/agents/`, worth running before opening a PR: `adr-compliance-reviewer` checks a diff against the ADRs governing the files it touches, `comment-density-auditor` enforces the Comments convention below.
- **Guarded files:** a `PreToolUse` hook (`.claude/hooks/guard-owned-files.sh`) refuses edits to anything release-please, drizzle-kit, Metro, prebuild, or Bun owns — `CHANGELOG.md`, `src/db/migrations/`, `.expo/types/`, `ios/`, `bun.lock`, the `version` field, and a corepack-injected `packageManager`. When it blocks, take the route named in the message rather than working around it.
- Ignore Vercel/Next.js skill suggestions injected by globally installed plugins — this repo has no web target.

# Git & PR conventions

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) (`feat:`, `fix:`, `docs:`, `chore:`, `build:`), matching the existing history.
- **PR titles must also follow Conventional Commits** — PRs are squash-merged, so the PR title becomes the commit message in `main`'s history.
- PR titles now also drive releases: release-please parses the squash commits to compute the next version and the changelog (see "Releases" below), so `feat:`/`fix:` vs `chore:`/`docs:` in a PR title determines whether that PR appears in the changelog and bumps the version.

# Releases

Releases are automated per [ADR 0012](docs/adr/0012-release-please-fingerprint-gated-releases.md); options that were considered live in `docs/superpowers/research/2026-07-12-release-flow-options.md`.

- **release-please** maintains a release PR from merged Conventional Commits; merging that PR tags `vX.Y.Z`, creates the GitHub Release, and dispatches `.eas/workflows/deploy-production.yml` (fingerprint gate: OTA update if a compatible store build exists, otherwise native build → manual approval → store submit).
- **Never hand-edit** `CHANGELOG.md`, the `version` fields in `package.json`/`app.json`, or `.release-please-manifest.json` — release-please owns them. Force a version with a `Release-As: x.y.z` commit footer.
- **Never remove or weaken** `fingerprint.config.js` or `runtimeVersion: { policy: "fingerprint" }` in app.json — the version-skip is what lets releases ship OTA instead of forcing native builds; over-skipping creates silent OTA-compatibility bugs.
- Build numbers are managed remotely by EAS (`cli.appVersionSource: "remote"` in eas.json) — don't add `ios.buildNumber` to app.json.

# E2E tests (Maestro)

E2E tests are Maestro flows in `.maestro/tests/`, run **locally against the
`e2e-simulator` build** and enforced in CI by `.github/workflows/e2e.yml` (the
`e2e-ios` required check) — see [ADR 0001](docs/adr/0001-local-first-maestro-e2e-testing.md).

- **Prerequisites:** Maestro CLI installed, a booted iOS simulator, and the E2E
  app built *and installed* onto it — the suite no longer needs Metro or the dev
  client. Reach for the `e2e-refresh` skill rather than doing this by hand: it
  mirrors the CI fingerprint gate below, repacks current JS into the cached
  native `.app` when the hash still matches (~1 min instead of a 15–20 min
  rebuild), and proves the install landed by comparing `main.jsbundle` hashes
  device-against-built. By hand it is `bun run e2e:build`, which writes
  `build/e2e-simulator.tar.gz` (gitignored), and then — **a separate step**, and
  the suite will happily keep running an older install until you take it,
  failing only the flows that assert new app behaviour —
  `tar -xzf build/e2e-simulator.tar.gz -C build && xcrun simctl install booted build/RunBroe2e.app`.
  Export `APP_VARIANT=e2e` for every Expo command in this path: the `e2e-ios`
  job sets it at job level, and the fingerprint differs without it. Flows launch
  via `appId` `se.lukaslindqvist.runbro.e2e` — the e2e build's identity. The app
  identity is variant-driven via the `APP_VARIANT` env var
  ([ADR 0019](docs/adr/0019-app-variants-dynamic-config.md)): `development` builds
  use `se.lukaslindqvist.runbro.dev` / scheme `runbrodev`, `e2e` builds use
  `se.lukaslindqvist.runbro.e2e` / scheme `runbroe2e`, and unset (production /
  preview) keeps the clean `se.lukaslindqvist.runbro` / scheme `runbro`.
- **Run:** `maestro test .maestro/` for the full suite,
  `maestro test .maestro/tests/<flow>.yaml` for a targeted one. Prefer the CLI to
  the Maestro MCP server registered in `.mcp.json` (`list_devices` → `run`): only
  **one** automation server may own a simulator, so stop Argent's
  (`stop-all-simulator-servers`) and leave the Maestro MCP idle while the CLI
  runs, or every flow dies at `launchApp` with
  `Unable to set permissions … Failed to connect to 127.0.0.1:<port>` — the rival
  XCUITest runners kill and relaunch each other, stealing the port. The CLI tears
  its own driver down on exit; the MCP server keeps one alive, which is what
  poisons the *next* run and reads like a flow bug rather than a leftover driver.
- **CI build reuse:** the `e2e-ios` workflow caches the native simulator `.app`
  by `@expo/fingerprint` hash — JS-only PRs skip the build and repack the JS via
  `@expo/repack-app` (~5–7 min); native changes trigger a full `eas build
  --local` and re-cache. See the fingerprint-reuse design spec. `eas.json` is
  itself a fingerprint source, and `e2e-simulator` `extends: "preview"` where EAS
  **shallow-merges `env`** — child keys win, parent-only keys survive — so any env
  var added to `preview` reaches the E2E build too unless that profile overrides
  it explicitly (`EXPO_PUBLIC_FIELD_TEST: "0"` is there for that reason).
- **Layout:** journey flows live in `.maestro/tests/` (tagged `onboarding` /
  `session`), shared steps in `.maestro/helpers/`; `config.yaml` discovers
  `tests/*.yaml`. Targeted runs: `maestro test --include-tags session .maestro/`.
- **Selectors ([ADR 0016](docs/adr/0016-text-first-maestro-selectors.md)):**
  target user-visible text (anchored regex — `Week 1 ·.*`); assert a screen's
  unique heading before tapping its CTA; disambiguate repeats with `index`;
  wrap scrollable-list targets in `scrollUntilVisible`. Ids are escape hatches
  only, commented at each use site — currently the icon-only `plan-next-*`
  arrow. An icon-only **native** control is not one of those cases: tap its
  `accessibilityLabel` (`tapOn: "Close"` hits the run summary's toolbar `xmark`;
  ADR 0016's 2026-07-30 amendment), and keep those labels distinct across
  stacked modals. Ground every string with the MCP `inspect_screen` tool against the
  running app; consult the MCP `cheat_sheet` tool and
  https://docs.maestro.dev/llms.txt for flow syntax.
  If a future escape hatch needs a `testID` on a bare `@expo/ui` SwiftUI
  `Text`, wrap it in a container (`HStack`) — the id doesn't surface otherwise.
  `@expo/ui` `LabeledContent` surfaces one merged element (`"Access, Never"`),
  so match its value as a suffix (`.*Never`), never on its own.
- **Location permission values:** on the iOS simulator Maestro's `location` key
  takes `inuse` / `always` / `never` / `unset` — *not* the `allow` / `deny` the
  cheat sheet documents for every other permission (they map to
  `simctl privacy grant|revoke location[-always]`, and an unknown value fails
  the flow before it launches). `inuse` is the one that matches what the app
  actually requests (When-In-Use, ADR 0008). **`motion: allow` must ride alongside
  it** in every `permissions:` block: the barometer needs Motion & Fitness
  (ADR 0015) and iOS raises that dialog when the altimeter first starts, mid-run.
  A system alert is **not app state**, so `clearState` does not dismiss it — the
  first flow to trigger it strands every later flow behind it, which reads as
  13/13 failing on their opening assertion rather than as one permission gap.
  Adding a permission the app requests means auditing every `permissions:` block:
  today that is `helpers/launch-and-onboard.yaml` plus the five tests that launch
  without it.
- **Compressed plan:** the `e2e-simulator` build sets `EXPO_PUBLIC_E2E=1`,
  which makes the seconds-long compressed plan reachable (`src/services/e2e.ts`)
  and default-on, so a full session finishes in seconds with no toggle
  interaction.
- **GPS *motion* cannot be tested by Maestro — don't write a flow that needs it**
  ([ADR 0001](docs/adr/0001-local-first-maestro-e2e-testing.md), 2026-07-31
  amendment). `travel` is not a real primitive: it loops `setLocation`
  (upstream [#921](https://github.com/mobile-dev-inc/maestro/issues/921)), and
  Maestro's iOS driver never calls `xcrun simctl location`, so CoreLocation
  reports no movement and the app records ~0 m. Measured, not guessed: 2 and 3
  waypoints both gave ~1.2 m, 11 waypoints hung, and adding a foreground
  `watchPositionAsync` changed nothing. `run-distance.yaml` was removed for this
  reason — anything needing recorded distance, pace or a drawn route belongs to
  [the device checklist](docs/milestone-0-device-checklist.md), not `.maestro/`.
  To verify by hand, drive the simulator's own route engine (this *does* work,
  and the whole former flow passes under it) — but never as a suite step, since
  `complete-session.yaml` asserts the absence of distance:
  `xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686`
- **Policy:** the full suite is the maintainer's — run locally before merging to
  `main` any change touching `src/`, `app.json`, or dependencies — and the
  `e2e-ios` check's. Agents run the *targeted* flows their change affects, via
  `e2e-refresh`, and report at handoff which flows passed and which text anchors
  the change renamed.
- **Tool split:** Maestro is for scripted, repeatable E2E regression flows; the Argent
  MCP tools (see `.claude/rules/argent.md`) are for interactive dev-time work —
  exploratory QA, driving the simulator while implementing, debugging, and profiling.
  Argent's own flow record/replay (`flow-*` tools) is a dev-loop convenience (e.g.
  re-profiling after a fix), not a second E2E layer — regression flows live only in
  `.maestro/`. **Caveat:** that split holds for *driving* the app, not for *finding*
  elements — argent's discovery tools are blind to this app's SwiftUI islands, so even
  interactive dev-time QA has to locate and tap through Maestro. See the Argent bullet
  under "Skills & MCP" above. **Second caveat, HealthKit's own authorization sheet:**
  it inverts even that — Maestro's `inspect_screen` sees `HealthPrivacyService`'s system
  sheet in full, but its `tapOn` is a no-op there (a remote view controller, not this
  app's process); Argent's `gesture-tap` is what actually drives it.
- **Device gate:** what E2E cannot reach (locked-phone GPS continuity, cue audibility, ducking, silent switch, Bluetooth, call interruption) is covered by [docs/milestone-0-device-checklist.md](docs/milestone-0-device-checklist.md).

# Comments & documentation

Architecture lives in ADRs; code should be self-explanatory. Comment only to add
what the code and types cannot carry — when in doubt, delete the comment and fix
the name or the type instead. (Retro: the first Stage-3 files landed ~49% comment
lines, port files ~80% — JSDoc restating architecture and types. Don't repeat that.)

- **Explain WHY, not WHAT** — never restate the code, the signature, or the types.
- **Don't re-describe architecture** — reference the ADR (`// per ADR 0008`); don't re-explain ports/adapters, the event-log engine, etc.
- **Rationale goes where it lives:** durable design → an ADR; why-this-change → the commit/PR body (Conventional Commits); a local non-obvious choice → a one-line `// why:` at the site.
- **Types are the source of truth** (strict TS, [ADR 0014](docs/adr/0014-eslint-prettier-linting-stack.md)) — never write types in JSDoc (`@param {T}`, `@returns`, `@enum`, `@private`).
- **JSDoc an exported symbol only** when its contract isn't obvious from the signature: units, ranges, rounding, null/empty semantics, ordering, side effects, throws. One line where possible; skip `@param`/`@returns` that add nothing.
- **No** narrative JSDoc on internal/domain helpers; **no** commented-out code; keep interface comments free of implementation detail (if you can't, the abstraction is too shallow).
- Non-obvious code: simplify it first; comment only what can't be simplified.

# Architecture

- **Routing:** expo-router file-based routing rooted at `src/app/` (entry point is `expo-router/entry` in package.json). Typed routes and the React Compiler are enabled via `experiments` in `app.json`.
- **Navigation:** the root layout `src/app/_layout.tsx` runs the Drizzle migrations gate (`useMigrations`, blocking on the splash screen) and an `OnboardingGate` that pushes the first pending onboarding step, then renders the root `Stack` wrapped in `ThemeProvider`. Tabs live in `src/app/(tabs)/_layout.tsx` (`NativeTabs` from `expo-router/unstable-native-tabs`; adding a tab = a route file under `src/app/(tabs)/` plus a matching `NativeTabs.Trigger` there). Every modal surface (`session/[key]`, `run`, `runs/[runId]`, `onboarding`) is a root-`Stack` screen with a native `presentation` option (ADR 0006).
- **Path aliases:** `@/*` → `src/*` and `@/assets/*` → `assets/*` (tsconfig.json). Use these instead of relative imports.
- **Platform forks (ADR 0025):** `.ios.tsx` / `.android.tsx` pairs at three levels — port adapters (`services/*/adapter.<platform>.ts`), the `island/` seam and the SwiftUI-vocabulary domain components (`run-transport`, `run-lock`, `run-unavailable`, `stat-grid`, `settings-toggle`), and the three pure-SwiftUI tab routes (`(tabs)/(index)`, `log`, `settings`: unsuffixed iOS body + `index.android.tsx`). Shared code imports the unsuffixed name and stays platform-blind; a `Platform.select`/`Platform.OS` inline is for a one-line difference only (`ui/text.tsx`, `skia-countdown.tsx`, `keep-awake-while-mounted.tsx`, `onboarding-store.ts`, the audio-cues primer's "Over your music" sentence in `onboarding/audio-cues.tsx`). Rules that bite: **expo-router bundles every platform's route files into both bundles and evaluates them** — a module a route fork imports must resolve on both platforms (hence `list-section-header.ios.tsx`, a stub), and the other platform's `@expo/ui` warns `Unable to get the view config …` at startup on both sides (harmless); `expo-symbols` names must be `{ ios, android }` pairs or Android renders nothing; Compose's `Icon` takes drawables, so icon-only controls are RN `Pressable` + `SymbolView`; an RN `Pressable` whose `onLongPress` depends on state re-fires `onPress` on release (keep both handlers mounted). ESLint forbids `@expo/ui/swift-ui` in `.android` files and `@expo/ui/jetpack-compose` in `.ios` files. No `.web.*` siblings. **Bottom safe-area inset on Android — forgotten repeatedly, check it every time:** iOS modals get the home-indicator inset from `contentInsetAdjustmentBehavior`, Android gets nothing and runs the last card into the gesture bar. A scrolling screen keeps its `ScrollView` edge-to-edge and pads the *content container* with Uniwind's `android:pb-safe-offset-N` (`contentContainerClassName`, the session sheet's idiom): **`safe-offset-10`** for plain content (the run summary), `safe-offset-6` only when a button ends the screen. Verify scrolled to the very bottom on the emulator — the bug never shows at the top.
- **Styling:** [Uniwind](https://docs.uniwind.dev) (Tailwind CSS v4 for React Native) is the main styling library — style with `className` directly on core RN components (`<View className="flex-1 bg-background">`); no Babel plugin or component wrappers needed. Metro is wired through `withUniwindConfig` in `metro.config.js` (it must stay the outermost wrapper) and auto-regenerates `src/uniwind-types.d.ts`. For third-party components without `className` support, wrap once with `withUniwind`; where an API needs a style object, use `useResolveClassNames`. Prefer `className` over `StyleSheet` in new code.
- **Theming (Android):** `use-theme.android.ts` maps the device's Material 3 palette (`getMaterialColors`, wallpaper-derived on Android 12+) onto the app's token names, and `applyPlatformTheme()` (root layout, module scope) pushes it into Uniwind's CSS variables at launch, so both Compose islands and RN surfaces follow Material You. `global.css`/`theme.ts` keep the iOS values.
- **Theming:** theme tokens live in `src/global.css` (imported by `src/app/_layout.tsx`) under `@variant light`/`@variant dark` blocks, producing utilities like `bg-background-element` and `text-foreground-secondary` that follow the system theme automatically. `src/constants/theme.ts` keeps a JS mirror of the palette (`Colors`) for the few places that need raw color values (`use-theme` hook) — keep it in sync with `global.css`. `ThemedText`/`ThemedView` are `className`-based wrappers over these tokens.
- **Maps:** `expo-maps` (`~57.0.1`, alpha) renders recorded routes behind the `RouteMap` **component port** (`src/components/route-map/`, [ADR 0010](docs/adr/0010-maps-expo-maps-ios18-floor.md)) — `AppleMaps.View` in `adapter.ios.tsx`, `GoogleMaps.View` in `adapter.android.tsx` (ADR 0025 stage 4; ADR 0010's 2026-09-21 amendment), imported nowhere else, with the camera-fit and simplification math kept as pure helpers in `src/domain/geo.ts` (`cameraForBoundingBox` is Apple's isotropic-degree zoom, `googleCameraForBoundingBox` Google's pixel-based one — the Android adapter measures itself with `onLayout` because the port carries only an aspect ratio). **Android key handling:** `app.config.ts` bakes `android.config.googleMaps.apiKey` from `GOOGLE_MAPS_ANDROID_API_KEY` — put the key in `.env.local` (gitignored, never committed; an EAS environment variable in stage 7) — and falls back to `MISSING_GOOGLE_MAPS_ANDROID_API_KEY` because a manifest with *no* key meta-data crashes the app (`API key not found` from `MapView.onCreate`) while an invalid key only logs `Authorization failure` and paints nothing (no tiles, no overlays, no logo; the SDK creates only the first `MapView` per process after that). That log line is the smoke signal for a missing/wrong key, not a crash. `fingerprint.config.js` strips the field from the `expoConfig` source, so the key never moves either platform's hash (ADR 0012's 2026-09-21 amendment). The field is a bare `android.*` one: after changing the key run `bun run prebuild:dev:android` and a Gradle build, or nothing changes. Restrict the key to package `se.lukaslindqvist.runbro.dev` + the SHA-1 of **prebuild's** `android/app/debug.keystore` (`5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25` — the Maps SDK prints the pair it saw in logcat), not `~/.android/debug.keystore`'s. Dark mode on the emulator is `adb shell cmd uimode night yes|no`; the adapter passes `LIGHT`/`DARK` explicitly from `useColorScheme()` because the SDK reads `FOLLOW_SYSTEM` only at map creation. **Route fixture:** a 1-minute compressed run under the geo feed records only ~50 m of extent, under `MIN_ROUTE_EXTENT_M` — start the feed *before* the run, use a real-plan session and end it by hand after 2+ minutes (4 min gave 239 points / 0.67 km). The floor is **iOS 17.0** via app.json's built-in `ios.deploymentTarget` (see that ADR's 2026-07-29 amendment; a change to this field does nothing until `bun run prebuild:dev` re-runs, because `expo run:ios` reuses an existing `ios/`). Two operational facts worth not rediscovering: **`expo-maps` throws at import when its native module is absent** — a top-level `requireNativeModule('ExpoMaps')`, so a JS-only repack into a pre-maps `.app` dies at import with `Cannot find native module 'ExpoMaps'` rather than degrading, and the first `e2e-refresh` after any native change must be a full rebuild; and the **`ios 17` simulator (iOS 17.5) is the runtime that covers expo-maps' second renderer** — the package runtime-branches iOS 18 → 17 → `EmptyView()` below 17, so the 17.x path is real shipped code that no iOS 26 simulator exercises, and map changes need a pass on both. **On iOS 17.5 the automation split inverts:** Maestro's XCUITest driver crashes against this app while snapshotting the hierarchy (it dies in `getHierarchyWithFallback`; CLI and MCP alike report `Failed to connect to 127.0.0.1:<port>`), whereas argent's `describe` returns the SwiftUI islands with usable frames there. (The parenthetical that used to call `describe` blind on iOS 26 was wrong — see the corrected Argent bullet above; `describe` works on both runtimes. What actually inverts on 17.5 is Maestro, which stops working.) So verify 17.5 with argent, and drive Dynamic Type and dark mode via `xcrun simctl ui <udid> content_size|appearance`, which argent has no tool for.
- **Components:** authored per [ADR 0013](docs/adr/0013-component-design-conventions.md) — shadcn/Radix-style: `src/components/ui/` style primitives with `cva` variants merged via `cn()` (caller `className` wins), `src/components/island/` wraps the repeated @expo/ui idioms, domain components at `src/components/` root, dot-notation compounds (`RadioToggle.Group`), paired `-foreground` tokens, screens compose only (no file-local components, no raw RN `Text`/`Pressable` in screens). Consult the ADR before adding or reshaping any component.
- **Current state:** Stage 1 (interval-timer MVP) is implemented — see `docs/superpowers/plans/2026-07-11-stage-1-interval-timer-mvp.md` for the delivery plan. Real layers: `src/domain/` is pure TS (NHS plan data, segment sequencing, formatting) covered by `bun test`, no RN runtime needed; `src/db/` is Drizzle over `expo-sqlite` with generated migrations (`bun run db:generate`); `src/services/` holds the run engine (event-log state machine, ADR 0007) plus the settings/onboarding/active-plan stores backed by `expo-sqlite/kv-store`; screens live under `src/app/` per spec §8 (plan list, run session, run summary, history, settings, onboarding). The run summary also renders a pace-vs-distance chart (`RunProfileCard`/`RunProfileChart`, re-derived from `run_points` on each open, no storage) via `victory-native` (ADR 0024), imported in exactly one file (`src/components/run-profile-chart.tsx`) — elevation was deferred whole to the barometer slice (ADR 0015's 2026-08-03 amendment), so this slice ships pace only. Barometer capture now ships behind an `ElevationSource` port (ADR 0015): every run logs altitude samples and field diagnostics in the same DB transaction as that run's GPS points and can export them per run, per `docs/field-test-capture-protocol.md` — but **elevation is still unrendered**, pending tuning from real field captures.

# Design docs & ADRs

Design specs live in `docs/superpowers/specs/` — `2026-07-11-c25k-app-design.md` is the master C25K spec; a separate implementation plan per delivery stage follows it. Architectural decisions live in `docs/adr/`. **Consult the relevant ADR before changing anything it governs**, and add new ADRs to this list:

- [ADR 0001 — Local-first Maestro E2E testing](docs/adr/0001-local-first-maestro-e2e-testing.md)
- [ADR 0002 — Uniwind as the styling engine](docs/adr/0002-uniwind-styling-engine.md)
- [ADR 0003 — Platform capabilities behind ports & adapters](docs/adr/0003-platform-ports-and-adapters.md)
- [ADR 0004 — Local storage: expo-sqlite + Drizzle ORM with a sync-agnostic schema](docs/adr/0004-local-storage-expo-sqlite-drizzle.md)
- [ADR 0005 — System-native UI via @expo/ui SwiftUI islands](docs/adr/0005-system-native-ui-expo-ui.md)
- [ADR 0006 — Every modal surface is an expo-router screen with native presentation](docs/adr/0006-modal-surfaces-as-router-screens.md)
- [ADR 0007 — Run engine: a wall-clock, event-log state machine](docs/adr/0007-run-engine-event-log.md)
- [ADR 0008 — Background execution: When-In-Use location as the locked-phone heartbeat](docs/adr/0008-background-execution-location-heartbeat.md)
- [ADR 0009 — Cue audio: TTS on the shared audio session, pre-recorded fallback](docs/adr/0009-cue-audio-tts-prerecorded-fallback.md)
- [ADR 0010 — Maps: expo-maps (alpha) with an iOS 17.0 floor, react-native-maps fallback](docs/adr/0010-maps-expo-maps-ios18-floor.md)
- [ADR 0011 — Apple Health writes via @kingstinct/react-native-healthkit](docs/adr/0011-apple-health-kingstinct-healthkit.md)
- [ADR 0012 — Release flow: release-please with fingerprint-gated EAS deploys](docs/adr/0012-release-please-fingerprint-gated-releases.md)
- [ADR 0013 — Component design: variant-carrying primitives and compound modules](docs/adr/0013-component-design-conventions.md)
- [ADR 0014 — Linting: hardened ESLint via `expo lint`, Prettier as the formatter](docs/adr/0014-eslint-prettier-linting-stack.md)
- [ADR 0015 — Run elevation: on-device barometer-first behind an Elevation port](docs/adr/0015-run-elevation-on-device-barometer.md)
- [ADR 0016 — Text-first Maestro selectors](docs/adr/0016-text-first-maestro-selectors.md)
- [ADR 0017 — In-app donations: a client-only tip jar behind a Tip-jar port (expo-iap)](docs/adr/0017-in-app-donations-tip-jar.md)
- [ADR 0018 — Free-run route generation: on-device pure-JS loop heuristic behind a Route-generator port](docs/adr/0018-free-run-route-generation.md)
- [ADR 0019 — App variants via dynamic app.config.ts selected by APP_VARIANT](docs/adr/0019-app-variants-dynamic-config.md)
- [ADR 0020 — iOS-only for now: Android support deferred](docs/adr/0020-ios-only-android-deferred.md)
- [ADR 0021 — On-device GPS track smoothing; no map-matching](docs/adr/0021-on-device-gps-track-smoothing.md)
- [ADR 0022 — Active-run Live Activity via first-party expo-widgets, updated locally](docs/adr/0022-active-run-live-activity-expo-widgets.md)
- [ADR 0023 — Completion as a projection over two sources (runs ∪ manual marks); week-focus derives from it](docs/adr/0023-session-completion-projection-manual-marks.md)
- [ADR 0024 — Charting: victory-native as an official-tooling exception, contained to one file](docs/adr/0024-victory-native-charting.md)
- [ADR 0025 — Android support: a staged migration behind the existing seams](docs/adr/0025-android-staged-migration.md) (supersedes ADR 0020; its stage table is the migration's source of truth)
