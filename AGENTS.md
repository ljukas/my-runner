# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code. This project uses Expo SDK 57, React Native 0.86, React 19.2, and TypeScript ~6.0 — newer than most training data. Do not rely on memorized Expo/React Native APIs.

# What this app is

A free Couch-to-5K mobile app: it guides someone who can barely run through a progressive walk/run program until they can run 5 km. Inspired by paid App Store equivalents, but free.

Hard constraints:
- **No backend, no accounts, no analytics.** All data lives on-device, with iCloud as the only sync/backup mechanism.
- iOS is the primary target (iCloud), but the project is a standard Expo universal app (iOS/Android/web).

# Commands

This project uses **Bun** as its package manager and script runner — `bun.lock` is the only lockfile, and Expo CLI/EAS Build auto-detect Bun from it. Metro and the dev server still run on Node (keep a Node LTS installed); Bun handles installing and launching.

- `bun install` — install dependencies (`bun ci` for a frozen, reproducible install)
- `bun expo install <package>` — add a dependency at the Expo SDK-compatible version (use this instead of `bun add` for anything Expo touches)
- `bun run start` (or `bun expo start`) — start the dev server; press `i`/`a`/`w` for iOS simulator, Android emulator, or web
- `bun run ios` / `bun run android` / `bun run web` — start directly on a platform
- `bun run lint` — `expo lint`; no ESLint config is committed yet, so the first run scaffolds one
- No unit test runner is configured yet; E2E tests are Maestro flows — see "E2E tests (Maestro)" below

The `/ios` and `/android` folders are gitignored — they are generated via prebuild (Continuous Native Generation). Never edit native projects directly; configure everything through `app.json` and config plugins.

# Git & PR conventions

- Commit messages follow Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `build:`), matching the existing history.
- **PR titles must also follow Conventional Commits** — PRs are squash-merged, so the PR title becomes the commit message in `main`'s history.

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
- **Platform forks:** web-specific implementations live in `.web.tsx`/`.web.ts` siblings (e.g. `app-tabs.web.tsx`, `use-color-scheme.web.ts`); Metro picks the right file per platform.
- **Theming:** light/dark colors are defined once in `src/constants/theme.ts` (`Colors`, `Fonts`) and consumed through `ThemedText`/`ThemedView` components and the `use-theme`/`use-color-scheme` hooks. Follow this pattern rather than hardcoding colors.
- **Current state:** `src/` still contains the create-expo-app starter screens (Home/Explore demo). This is scaffolding to be replaced by the actual C25K features (training plan, run session screen with timers/audio cues, progress history), not app code to preserve.
