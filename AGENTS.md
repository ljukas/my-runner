# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. This project uses Expo SDK 57, React Native 0.86, React 19.2, and TypeScript ~6.0 — newer than most training data. Do not rely on memorized Expo/React Native APIs.

# What this app is

A free Couch-to-5K mobile app: it guides someone who can barely run through a progressive walk/run program until they can run 5 km. Inspired by paid App Store equivalents, but free.

Hard constraints:
- **No backend, no accounts, no analytics.** All data lives on-device, with iCloud as the only sync/backup mechanism.
- iOS only (for now): iOS is the sole supported platform (`platforms: ["ios"]` in app.json, with iCloud sync). Android is not supported atm — no `android/` project is generated — though it may return as a secondary target later. There is no web target — react-native-web has been removed.

# Commands

This project uses **Bun** as its package manager and script runner — `bun.lock` is the only lockfile, and Expo CLI/EAS Build auto-detect Bun from it. Metro and the dev server still run on Node (keep a Node LTS installed); Bun handles installing and launching.

> **corepack gotcha:** with corepack auto-pin on (the default), running any Expo command (`bun expo …`, `bunx expo-doctor`) makes corepack write a spurious `"packageManager": "yarn@…"` field into `package.json`. This repo is Bun-only — **never commit that field**: a committed `packageManager: yarn` can make EAS Build / the CI `e2e-ios` job honor Yarn over `bun.lock` and break the build. Prevent it with `export COREPACK_ENABLE_AUTO_PIN=0` in your shell; if the field appears, delete it before committing.

- `bun install` — install dependencies (`bun ci` for a frozen, reproducible install)
- `bun expo install <package>` — add a dependency at the Expo SDK-compatible version (use this instead of `bun add` for anything Expo touches)
- `bun run start` — `expo run:ios`: compile and install the iOS dev-client build and start the Metro dev server. Required on first run and after any native change (new native dependency, config plugin, native app.json fields). The app uses expo-dev-client, not Expo Go. To start Metro only — when the app is already installed, or you just need typed routes regenerated — run `bun expo start` directly. (iOS-only atm; there is no `run:android` script.)
- `bun run lint` — `expo lint` against the committed `eslint.config.js` (ADR 0014: includes Prettier formatting + Uniwind class sorting as lint errors, and type-aware `no-floating-promises` in `src/`; `bun run lint --fix` auto-formats)
- `bun test` — runs the unit suites (pure-TS `domain/` and `services/`; no RN runtime needed)
- `bun run typecheck` — `tsc --noEmit`. Depends on two **gitignored generated files**: `expo-env.d.ts` and `.expo/types/router.d.ts` (typed routes). In a fresh clone or worktree it fails (`TS2882` on `@/global.css`, then route-typing errors) until you start the dev server once — `bun expo start` on any free port, kill it as soon as `.expo/types/router.d.ts` appears. Never copy `.expo/types/router.d.ts` from another checkout: it encodes that branch's route files and produces misleading type errors on this one.
- `bun run db:generate` — regenerates Drizzle migrations after editing `src/db/schema.ts` (commit the generated output)
- `bun run e2e` — run the full Maestro E2E suite against the `e2e-simulator` build on a booted simulator (`bun run e2e:onboarding` / `bun run e2e:session` for tagged subsets; `bun run e2e:build` to produce the `e2e-simulator` app via `eas build --local`). See "E2E tests (Maestro)" below.

The `/ios` folder is gitignored — it is generated via prebuild (Continuous Native Generation). `platforms: ["ios"]` in app.json means no `android/` project is generated (iOS-only atm). Never edit native projects directly; configure everything through `app.json` and config plugins.

# Skills & MCP — what to load when

Load the matching skill (Skill tool) BEFORE starting the work it covers. MCP servers are configured in `.mcp.json` (argent, maestro).

- **All on-device/simulator work goes through Argent** — `.claude/rules/argent.md` has the full skill-routing table. Implementation is iterated agentically on the iOS simulator: make a change → run the app → drive and verify it with argent tools. Any change affecting visible UI, navigation, layout, or copy must be verified on the simulator this way before it's considered done. Typical loads: `argent-ios-simulator-setup` (boot, UDID), `argent-react-native-app-workflow` (run the app, Metro, builds, logs), `argent-device-interact` (tap/type/screenshot), `argent-test-ui-flow` (QA loops), `argent-react-native-profiler` / `argent-react-native-optimization` (performance).
- **`react-native-best-practices`** — load before writing or editing any `.tsx` / React Native component code (re-renders, lists, animations, JS-thread work). Applies to all UI implementation, not only perf-labelled tasks.
- **Expo plugin skills** (from `expo@claude-plugins-official`, enabled in `.claude/settings.json`): `expo-app-design:building-native-ui` when building screens/navigation/UI with expo-router; `expo-app-design:expo-dev-client` when producing dev-client builds; `upgrading-expo` for SDK upgrades; `expo-deployment:expo-cicd-workflows` when writing `.eas/workflows/` YAML (the release-deploy pipeline — ADR 0012; the E2E CI gate is GitHub Actions per ADR 0001). Do NOT use `expo-app-design:expo-tailwind-setup` — styling here is Uniwind (ADR 0002), not NativeWind.
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
- Build numbers are managed remotely by EAS (`cli.appVersionSource: "remote"` in eas.json) — don't add `ios.buildNumber` to app.json.

# E2E tests (Maestro)

E2E tests are Maestro flows in `.maestro/tests/`, run **locally against the
`e2e-simulator` build** and enforced in CI by `.github/workflows/e2e.yml` (the
`e2e-ios` required check) — see [ADR 0001](docs/adr/0001-local-first-maestro-e2e-testing.md).

- **Prerequisites:** Maestro CLI installed, a booted iOS simulator, and the E2E
  app built via `eas build --local -p ios -e e2e-simulator` and installed onto
  it — the suite no longer needs Metro or the dev client. Flows launch via
  `appId` `se.lukaslindqvist.runbro.e2e` — the e2e build's identity. The app
  identity is variant-driven via the `APP_VARIANT` env var
  ([ADR 0019](docs/adr/0019-app-variants-dynamic-config.md)): `development` builds
  use `se.lukaslindqvist.runbro.dev` / scheme `runbrodev`, `e2e` builds use
  `se.lukaslindqvist.runbro.e2e` / scheme `runbroe2e`, and unset (production /
  preview) keeps the clean `se.lukaslindqvist.runbro` / scheme `runbro`.
- **Run:** `maestro test .maestro/` for the full suite, or through the Maestro MCP
  server registered in `.mcp.json` (`list_devices` → `run`).
- **CI build reuse:** the `e2e-ios` workflow caches the native simulator `.app`
  by `@expo/fingerprint` hash — JS-only PRs skip the build and repack the JS via
  `@expo/repack-app` (~5–7 min); native changes trigger a full `eas build
  --local` and re-cache. See the fingerprint-reuse design spec.
- **Layout:** journey flows live in `.maestro/tests/` (tagged `onboarding` /
  `session`), shared steps in `.maestro/helpers/`; `config.yaml` discovers
  `tests/*.yaml`. Targeted runs: `maestro test --include-tags session .maestro/`.
- **Selectors ([ADR 0016](docs/adr/0016-text-first-maestro-selectors.md)):**
  target user-visible text (anchored regex — `Week 1 ·.*`); assert a screen's
  unique heading before tapping its CTA; disambiguate repeats with `index`;
  wrap scrollable-list targets in `scrollUntilVisible`. Ids are escape hatches
  only, commented at each use site — currently the icon-only `plan-next-*`
  arrow. Ground every string with the MCP `inspect_screen` tool against the
  running app; consult the MCP `cheat_sheet` tool and
  https://docs.maestro.dev/llms.txt for flow syntax.
  If a future escape hatch needs a `testID` on a bare `@expo/ui` SwiftUI
  `Text`, wrap it in a container (`HStack`) — the id doesn't surface otherwise.
- **Compressed plan:** the `e2e-simulator` build sets `EXPO_PUBLIC_E2E=1`,
  which makes the seconds-long compressed plan reachable (`src/services/e2e.ts`)
  and default-on, so a full session finishes in seconds with no toggle
  interaction.
- **Policy:** run the full suite locally before merging to `main` any change touching
  `src/`, `app.json`, or dependencies; run targeted flows during development as needed.
- **Tool split:** Maestro is for scripted, repeatable E2E regression flows; the Argent
  MCP tools (see `.claude/rules/argent.md`) are for interactive dev-time work —
  exploratory QA, driving the simulator while implementing, debugging, and profiling.
  Argent's own flow record/replay (`flow-*` tools) is a dev-loop convenience (e.g.
  re-profiling after a fix), not a second E2E layer — regression flows live only in
  `.maestro/`.

# Architecture

- **Routing:** expo-router file-based routing rooted at `src/app/` (entry point is `expo-router/entry` in package.json). Typed routes and the React Compiler are enabled via `experiments` in `app.json`.
- **Navigation:** the root layout `src/app/_layout.tsx` runs the Drizzle migrations gate (`useMigrations`, blocking on the splash screen) and an `OnboardingGate` that pushes the first pending onboarding step, then renders the root `Stack` wrapped in `ThemeProvider`. Tabs live in `src/app/(tabs)/_layout.tsx` (`NativeTabs` from `expo-router/unstable-native-tabs`; adding a tab = a route file under `src/app/(tabs)/` plus a matching `NativeTabs.Trigger` there). Every modal surface (`session/[key]`, `run`, `run-summary`, `onboarding`) is a root-`Stack` screen with a native `presentation` option (ADR 0006).
- **Path aliases:** `@/*` → `src/*` and `@/assets/*` → `assets/*` (tsconfig.json). Use these instead of relative imports.
- **Platform forks:** the app is iOS-only (no web target, no Android atm), with no `.web.tsx`/`.web.ts` siblings. Handle any platform/OS-version branching inline via `Platform.select`/`Platform.OS` rather than platform-suffixed files.
- **Styling:** [Uniwind](https://docs.uniwind.dev) (Tailwind CSS v4 for React Native) is the main styling library — style with `className` directly on core RN components (`<View className="flex-1 bg-background">`); no Babel plugin or component wrappers needed. Metro is wired through `withUniwindConfig` in `metro.config.js` (it must stay the outermost wrapper) and auto-regenerates `src/uniwind-types.d.ts`. For third-party components without `className` support, wrap once with `withUniwind`; where an API needs a style object, use `useResolveClassNames`. Prefer `className` over `StyleSheet` in new code.
- **Theming:** theme tokens live in `src/global.css` (imported by `src/app/_layout.tsx`) under `@variant light`/`@variant dark` blocks, producing utilities like `bg-background-element` and `text-foreground-secondary` that follow the system theme automatically. `src/constants/theme.ts` keeps a JS mirror of the palette (`Colors`) for the few places that need raw color values (`use-theme` hook) — keep it in sync with `global.css`. `ThemedText`/`ThemedView` are `className`-based wrappers over these tokens.
- **Components:** authored per [ADR 0013](docs/adr/0013-component-design-conventions.md) — shadcn/Radix-style: `src/components/ui/` style primitives with `cva` variants merged via `cn()` (caller `className` wins), `src/components/island/` wraps the repeated @expo/ui idioms, domain components at `src/components/` root, dot-notation compounds (`RadioToggle.Group`), paired `-foreground` tokens, screens compose only (no file-local components, no raw RN `Text`/`Pressable` in screens). Consult the ADR before adding or reshaping any component.
- **Current state:** Stage 1 (interval-timer MVP) is implemented — see `docs/superpowers/plans/2026-07-11-stage-1-interval-timer-mvp.md` for the delivery plan. Real layers: `src/domain/` is pure TS (NHS plan data, segment sequencing, formatting) covered by `bun test`, no RN runtime needed; `src/db/` is Drizzle over `expo-sqlite` with generated migrations (`bun run db:generate`); `src/services/` holds the run engine (event-log state machine, ADR 0007) plus the settings/onboarding/active-plan stores backed by `expo-sqlite/kv-store`; screens live under `src/app/` per spec §8 (plan list, run session, run summary, history, settings, onboarding).

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
- [ADR 0013 — Component design: variant-carrying primitives and compound modules](docs/adr/0013-component-design-conventions.md)
- [ADR 0014 — Linting: hardened ESLint via `expo lint`, Prettier as the formatter](docs/adr/0014-eslint-prettier-linting-stack.md)
- [ADR 0015 — Run elevation: on-device barometer-first behind an Elevation port](docs/adr/0015-run-elevation-on-device-barometer.md)
- [ADR 0016 — Text-first Maestro selectors](docs/adr/0016-text-first-maestro-selectors.md)
- [ADR 0017 — In-app donations: a client-only tip jar behind a Tip-jar port (expo-iap)](docs/adr/0017-in-app-donations-tip-jar.md)
- [ADR 0018 — Free-run route generation: on-device pure-JS loop heuristic behind a Route-generator port](docs/adr/0018-free-run-route-generation.md)
- [ADR 0019 — App variants via dynamic app.config.ts selected by APP_VARIANT](docs/adr/0019-app-variants-dynamic-config.md)
- [ADR 0020 — iOS-only for now: Android support deferred](docs/adr/0020-ios-only-android-deferred.md)
- [ADR 0022 — Active-run Live Activity via first-party expo-widgets, updated locally](docs/adr/0022-active-run-live-activity-expo-widgets.md)
