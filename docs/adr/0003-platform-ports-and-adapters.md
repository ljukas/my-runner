# 3. Platform capabilities behind ports & adapters

Date: 2026-07-11

## Status

Accepted

## Context

The C25K design spec (§7) commits to iOS-first v1 with Android adapters
plugging in later, and identifies five platform-touching capabilities:
Apple Health, spoken cues, location tracking, the route map, and (v2) backup.
Several forces shape how those capabilities should enter the codebase:

- The run engine must be unit-testable under `bun test` (spec §10). It cannot
  import Expo SDKs directly, or every engine test would need to mock native
  modules.
- Two fallbacks are pre-decided and must be swappable without touching the
  engine: pre-recorded cue files if TTS fails the Milestone-0 device spike,
  and react-native-maps if expo-maps alpha disappoints.
- HealthKit is iOS-only; the other capabilities are cross-platform Expo
  libraries that differ per platform only in configuration.
- expo-task-manager requires task definitions in the **global (module) scope**
  of the JS bundle — they cannot live in React lifecycle code, because iOS may
  launch the app headless in the background to run the task (verified in the
  SDK 57 docs).
- Metro resolves platform file extensions (`.ios.ts` / `.android.ts` /
  `.native.ts`) for any module, not just components. TypeScript does **not**
  do this by default: `expo/tsconfig.base` (SDK 57) sets
  `moduleResolution: "bundler"` with no `moduleSuffixes`, so fork imports need
  an explicit typing strategy.
- CNG applies: adapters are TypeScript over Expo modules and config plugins,
  never edits to native projects.

## Decision

Every platform-touching capability sits behind a **port** — a small TypeScript
interface — implemented by per-platform **adapters**.

1. **Ports** live in `services/<capability>/port.ts` with zero platform
   imports: only types. Callers (run engine, screens, `domain/`) import the
   port type and the service — never an Expo/native SDK. `domain/` stays 100%
   free of React and Expo imports.
2. **Adapters** implement ports as sibling files selected by Metro platform
   resolution: `adapter.ios.ts` now, `adapter.android.ts` later. Each adapter
   explicitly annotates its export with the port type
   (`export const healthAdapter: HealthAdapter = …`), so cross-platform
   contract safety comes from the port interface, not from comparing forks.
3. **TypeScript resolution** of fork imports uses
   `"moduleSuffixes": [".ios", ".native", ""]` in `tsconfig.json`, added when
   the first fork lands. `tsc --noEmit` (the CI `checks` job) still
   type-checks every fork file individually because `include` covers
   `**/*.ts`; consumer-side resolution is simply anchored to the iOS fork.
   When Android adapters land, a second config
   (`tsconfig.android.json` with `[".android", ".native", ""]`) joins CI so
   both resolutions are checked.
4. **Composition:** the run engine receives its ports via constructor
   injection at a single composition root; screens consume service
   singletons. No DI container.
5. **Component ports** (currently only `RouteMap`) use the same file-resolution
   mechanism under `components/`.
6. The background location task is defined at **module scope inside the
   location-tracker adapter** and imported from the app entry, satisfying the
   expo-task-manager constraint; the port exposes only
   `start()` / `stop()` / `onFix(cb)`, so callers never see the task.
7. **Testing split:** engine and `domain/` are unit-tested with in-memory fake
   ports (`bun test`). Adapters get device-level verification (Milestone-0
   spike, Maestro flows, the manual checklist) — we do not unit-test adapters
   by mocking Expo SDK internals.

## Consequences

- Android support becomes "write adapters only": engine, domain, screens, and
  tests are untouched by the port contract.
- The pre-approved fallbacks (pre-recorded cues, react-native-maps) are
  adapter swaps behind stable interfaces — exactly the flexibility the
  Milestone-0 go/no-go gate requires.
- The engine is fully unit-testable with fakes; no native mocking anywhere.
- Cost: one extra layer of indirection, and five interfaces that must resist
  method bloat — ports stay as small as the spec §7 table defines them.
- Discipline required: nothing outside `services/` (and component ports) may
  import `expo-location`, `expo-speech`, `expo-audio`, `expo-maps`, or
  HealthKit. Follow-up: enforce with an ESLint `no-restricted-imports` rule
  once the ESLint config is scaffolded.
- `moduleSuffixes` anchors consumer-side type resolution to iOS until the
  Android tsconfig joins CI — acceptable while Android has no adapters.

## Alternatives considered

- **Direct SDK imports with `Platform.select` / `Platform.OS` branching** —
  rejected: the engine becomes untestable without native mocks, the Android
  retrofit touches every call site, and the pre-decided fallback swaps become
  invasive edits instead of adapter replacements.
- **DI container (tsyringe, InversifyJS)** — rejected: decorator and
  reflect-metadata friction under Hermes/Metro, and a container is oversized
  for five ports; constructor injection at one composition root suffices.
- **Implicit forks without shared interfaces** (platform files only, no port
  types) — rejected: no compile-time contract, so adapters drift apart
  silently.
- **Per-platform packages in a monorepo** — rejected: tooling overhead
  unjustified at this app's scale.
- **Neutral `adapter.ts` stub instead of `moduleSuffixes`** (a third file that
  carries the types for TS and throws at runtime) — viable, but rejected as
  the default: it adds a dead runtime file whose declared types can drift,
  while `moduleSuffixes` is the official TypeScript mechanism (TS ≥ 4.7,
  built for React Native) and composes cleanly with `expo/tsconfig.base`.
