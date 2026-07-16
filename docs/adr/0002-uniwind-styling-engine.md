# 2. Uniwind as the styling engine

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted (recorded retroactively — Uniwind was adopted in PR #1; this ADR
memorializes the decision now that it is the de facto styling engine).

## Context

The app needs one styling system for all React Native-rendered UI. Constraints
and preferences at adoption time:

- Tailwind utility vocabulary and design tokens that follow the system
  light/dark theme automatically.
- Mobile only — no web target, so universal-web support carries no weight.
- Minimal build complexity: no Babel preset, works with Metro on Expo SDK 57.
- The C25K design spec (§8) renders many product screens as SwiftUI islands
  (`@expo/ui`), which cannot consume Tailwind classes at all; the styling
  engine only governs the RN-rendered shells around them.

## Decision

[Uniwind](https://uniwind.dev) (`uniwind` 1.x, MIT, by Unistack) is the
styling engine for all React Native-rendered UI.

- Style with `className` directly on core RN components — no component
  wrappers, no Babel plugin. Prefer `className` over `StyleSheet` in new code.
- Metro is wired through `withUniwindConfig` in `metro.config.js`, which must
  stay the **outermost** wrapper. It auto-regenerates `src/uniwind-types.d.ts`
  (a generated file — never hand-edited).
- Theme tokens live in `src/global.css` under `@variant light` / `@variant
  dark` (plus `@variant ios` / `@variant android` for platform values),
  producing semantic utilities (`bg-background-element`,
  `text-foreground-secondary`) that track the system theme with no JS logic.
- Escape hatches: `withUniwind(Component)` wraps third-party components that
  lack `className` support; `useResolveClassNames(classes)` produces style
  objects for APIs that require them (e.g. navigation options).
- The few JS consumers that need raw color values read the `Colors` mirror in
  `src/constants/theme.ts`, kept in sync with `global.css` by hand.

## Consequences

- Tailwind v4 styling with build-time compilation and no Babel preset. (The
  vendor benchmarks claim significantly better performance than NativeWind;
  we have not independently verified this and did not need to — the
  no-Babel-preset setup and Tailwind v4 support were the deciding factors.)
- **Two sources of truth for the palette:** `global.css` (styling) and
  `constants/theme.ts` (JS mirror — also the bridge SwiftUI islands will use,
  see the upcoming system-UI ADR). Sync is manual and drift is a real failure
  mode; a codegen or lint check is a candidate follow-up if it bites.
- Young 1.x dependency with a small maintainer surface. Accepted: MIT, active,
  and both major Tailwind-for-RN systems share the `className` model, so a
  migration to NativeWind would be mechanical rather than a redesign.

## Alternatives considered

- **NativeWind** — the incumbent Tailwind-for-RN library. Rejected at
  adoption time: required a Babel preset and lagged on Tailwind v4, and its
  universal-web strengths are irrelevant here.
- **Plain `StyleSheet` + token constants** (the starter default) — rejected:
  verbose, manual theming, no utility vocabulary.
- **react-native-unistyles** — powerful styling runtime, but a different
  mental model (style objects, not Tailwind classes).
- **Tamagui** — full UI kit plus compiler; oversized buy-in and its component
  library conflicts with the system-native (`@expo/ui`) UI direction.
