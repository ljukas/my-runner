# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. This project uses Expo SDK 57, React Native 0.86, React 19.2, and TypeScript ~6.0 — newer than most training data. Do not rely on memorized Expo/React Native APIs.

# What this app is

A free Couch-to-5K mobile app: it guides someone who can barely run through a progressive walk/run program until they can run 5 km. Inspired by paid App Store equivalents, but free.

Hard constraints:
- **No backend, no accounts, no analytics.** All data lives on-device, with iCloud as the only sync/backup mechanism.
- Mobile only: iOS is the primary target (iCloud); Android is the secondary target. There is no web target — react-native-web has been removed.

# Commands

This project uses **Bun** as its package manager and script runner — `bun.lock` is the only lockfile, and Expo CLI/EAS Build auto-detect Bun from it. Metro and the dev server still run on Node (keep a Node LTS installed); Bun handles installing and launching.

- `bun install` — install dependencies (`bun ci` for a frozen, reproducible install)
- `bun expo install <package>` — add a dependency at the Expo SDK-compatible version (use this instead of `bun add` for anything Expo touches)
- `bun run start` (or `bun expo start`) — start the dev server; press `i`/`a` to open the app in the installed dev client on the iOS simulator or Android emulator
- `bun run ios` / `bun run android` — compile and install a dev-client build (`expo run:ios` / `expo run:android`) and start the dev server; required on first run and after any native change (new native dependency, config plugin, native app.json fields). The app uses expo-dev-client, not Expo Go.
- `bun run lint` — `expo lint`; no ESLint config is committed yet, so the first run scaffolds one
- No unit test runner is configured yet; E2E tests are Maestro flows — see "E2E tests (Maestro)" below

The `/ios` and `/android` folders are gitignored — they are generated via prebuild (Continuous Native Generation). Never edit native projects directly; configure everything through `app.json` and config plugins.

# Skills & MCP — what to load when

Load the matching skill (Skill tool) BEFORE starting the work it covers. MCP servers are configured in `.mcp.json` (argent, maestro).

- **All on-device/simulator work goes through Argent** — `.claude/rules/argent.md` has the full skill-routing table. Implementation is iterated agentically on the iOS simulator: make a change → run the app → drive and verify it with argent tools. Any change affecting visible UI, navigation, layout, or copy must be verified on the simulator this way before it's considered done. Typical loads: `argent-ios-simulator-setup` (boot, UDID), `argent-react-native-app-workflow` (run the app, Metro, builds, logs), `argent-device-interact` (tap/type/screenshot), `argent-test-ui-flow` (QA loops), `argent-react-native-profiler` / `argent-react-native-optimization` (performance).
- **`react-native-best-practices`** — load before writing or editing any `.tsx` / React Native component code (re-renders, lists, animations, JS-thread work). Applies to all UI implementation, not only perf-labelled tasks.
- **Expo plugin skills** (from `expo@claude-plugins-official`, enabled in `.claude/settings.json`): `expo-app-design:building-native-ui` when building screens/navigation/UI with expo-router; `expo-app-design:expo-dev-client` when producing dev-client builds; `upgrading-expo` for SDK upgrades; `expo-deployment:expo-cicd-workflows` when writing `.eas/workflows/` YAML (the future CI gate — ADR 0001). Do NOT use `expo-app-design:expo-tailwind-setup` — styling here is Uniwind (ADR 0002), not NativeWind.
- **Docs lookup:** use the Context7 MCP (`resolve-library-id` → `query-docs`) for Expo SDK 57 / React Native / library APIs — see "Expo HAS CHANGED" above. Prefer it over memory and over web search.
- **Maestro MCP** — scripted E2E regression flows only; see "E2E tests (Maestro)" for the Maestro-vs-argent split.
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
- Build numbers are managed remotely by EAS (`cli.appVersionSource: "remote"` in eas.json) — don't add `ios.buildNumber`/`android.versionCode` to app.json.

# E2E tests (Maestro)

E2E tests are Maestro flows in `.maestro/` at the repo root, run **locally** — see
`docs/adr/0001-local-first-maestro-e2e-testing.md` for the rationale and the plan
to make the EAS Workflows `maestro` job the CI gate later.

- **Prerequisites:** Maestro CLI installed, a booted iOS simulator, and the app
  built onto it via `bun run ios`.
- **Run:** `maestro test .maestro/` for the full suite, or through the Maestro MCP
  server registered in `.mcp.json` (`list_devices` → `run`).
- **Authoring:** use the MCP `inspect_screen` tool to read real element IDs from the
  running app instead of guessing selectors; consult the MCP `cheat_sheet` tool and
  https://docs.maestro.dev/llms.txt for flow syntax.
- **Policy:** run the full suite locally before merging to `main` any change touching
  `src/`, `app.json`, or dependencies; run targeted flows during development as needed.
- **Tool split:** Maestro is for scripted, repeatable E2E regression flows; the Argent
  MCP tools (see `.claude/rules/argent.md`) are for interactive dev-time work —
  exploratory QA, driving the simulator while implementing, debugging, and profiling.
  Argent's own flow record/replay (`flow-*` tools) is a dev-loop convenience (e.g.
  re-profiling after a fix), not a second E2E layer — regression flows live only in
  `.maestro/`.

`.maestro/` does not exist yet — it lands with the first flows once screens have
stable identifiers (`testID`s) and a first smoke flow is written (separate upcoming
task). Flows launch the app via its `appId`: `se.lukaslindqvist.myrunner` (set as both
`ios.bundleIdentifier` and `android.package` in `app.json`).

# Architecture

- **Routing:** expo-router file-based routing rooted at `src/app/` (entry point is `expo-router/entry` in package.json). Typed routes and the React Compiler are enabled via `experiments` in `app.json`.
- **Navigation:** the root layout `src/app/_layout.tsx` wraps the app in a `ThemeProvider` and renders `src/components/app-tabs.tsx`, which uses `NativeTabs` from `expo-router/unstable-native-tabs`. Adding a tab screen requires both a route file in `src/app/` and a matching `NativeTabs.Trigger` in `app-tabs.tsx`.
- **Path aliases:** `@/*` → `src/*` and `@/assets/*` → `assets/*` (tsconfig.json). Use these instead of relative imports.
- **Platform forks:** none — the app is mobile-only, with no `.web.tsx`/`.web.ts` siblings. Handle iOS/Android differences inline via `Platform.select`/`Platform.OS`.
- **Styling:** [Uniwind](https://docs.uniwind.dev) (Tailwind CSS v4 for React Native) is the main styling library — style with `className` directly on core RN components (`<View className="flex-1 bg-background">`); no Babel plugin or component wrappers needed. Metro is wired through `withUniwindConfig` in `metro.config.js` (it must stay the outermost wrapper) and auto-regenerates `src/uniwind-types.d.ts`. For third-party components without `className` support, wrap once with `withUniwind`; where an API needs a style object, use `useResolveClassNames`. Prefer `className` over `StyleSheet` in new code.
- **Theming:** theme tokens live in `src/global.css` (imported by `src/app/_layout.tsx`) under `@variant light`/`@variant dark` blocks, producing utilities like `bg-background-element` and `text-foreground-secondary` that follow the system theme automatically. `src/constants/theme.ts` keeps a JS mirror of the palette (`Colors`) for the few places that need raw color values (`use-theme` hook) — keep it in sync with `global.css`. `ThemedText`/`ThemedView` are `className`-based wrappers over these tokens.
- **Current state:** `src/` still contains the create-expo-app starter screens (Home/Explore demo). This is scaffolding to be replaced by the actual C25K features (training plan, run session screen with timers/audio cues, progress history), not app code to preserve.

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
- [ADR 0010 — Maps: expo-maps (alpha) with an iOS 18.0 floor, react-native-maps fallback](docs/adr/0010-maps-expo-maps-ios18-floor.md)
- [ADR 0011 — Apple Health writes via @kingstinct/react-native-healthkit](docs/adr/0011-apple-health-kingstinct-healthkit.md)
- [ADR 0012 — Release flow: release-please with fingerprint-gated EAS deploys](docs/adr/0012-release-please-fingerprint-gated-releases.md)
