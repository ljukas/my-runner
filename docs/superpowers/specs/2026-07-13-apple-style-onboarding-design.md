# Apple-Style Onboarding Welcome Screen — Design Spec

**Date:** 2026-07-13
**Status:** Approved pending final user review
**References:** Apple Games (dark) and Journal (light) welcome screens, provided as screenshots 2026-07-13

## 1. Overview

The app's design goal is to look as close to a system Apple app as possible. The
onboarding is the first surface a user sees, so it adopts Apple's first-launch
welcome template exactly: app icon, large "Welcome to …" title, tinted SF Symbol
feature rows, a small footnote block, and a Liquid Glass Continue button pinned
to the bottom of a full-height sheet. Light and dark mode are both supported via
the existing Uniwind theme tokens.

The current three text-only onboarding steps (welcome, how-it-works, health
note) collapse into **one** welcome screen. The versioned-step architecture and
the nested onboarding `Stack` stay: future releases that need permission
prompts (location, notifications, …) append steps that push inside the same
modal.

### Decisions log (agreed 2026-07-13)

| Topic | Decision |
|---|---|
| Content structure | Single welcome screen; how-it-works becomes feature rows, health note becomes the footnote block. Nested `Stack` retained for future permission steps |
| Rendering | RN body styled with Uniwind + one `@expo/ui` island for the CTA button (over full-SwiftUI screen or expo-glass-effect custom button) |
| Presentation | `presentation: 'modal'` (iOS pageSheet full-detent: rounded top corners, status bar visible above the card), `gestureEnabled: false` so it cannot be swiped away |
| Glass button | `@expo/ui` `Button` with `buttonStyle('glassProminent')` + primary tint on iOS 26+; `borderedProminent` below; RN pill on Android. **No new dependency** for glass |
| Icons | New first-party dependency `expo-symbols` (`SymbolView`) with cross-platform name maps; expo-image `sf:` rejected (iOS-only, Android rows would lose icons) |
| Step ids | Single `welcome-v1` entry remains in `ONBOARDING_STEPS`; `how-it-works-v1` / `health-note-v1` removed. Existing installs that completed `welcome-v1` never see onboarding again |

## 2. Screen structure & content

Top to bottom, mirroring the reference screenshots:

1. **App icon** — `assets/images/icon.png` at ~88 pt, centered, rounded
   superellipse corners (`borderCurve: 'continuous'`, radius ≈ 22 % of size).
2. **Title** — Journal-style two-line treatment, left-aligned, Apple Large
   Title metrics (34 pt bold — the existing `ThemedText` `title` type is 48 pt,
   too big; use explicit classes):
   - "Welcome to" in `text-primary`
   - "My Runner" in `text-foreground`
3. **Feature rows** — three rows of tinted SF Symbol (primary color) + bold
   title + secondary description, Apple Games style:
   | Symbol (iOS / Android) | Title | Description |
   |---|---|---|
   | `figure.run` / `directions_run` | From Couch to 5 km | Three short sessions a week for nine weeks — walking at first, running 30 minutes straight by the end. |
   | `timer` / `timer` | Guided Intervals | The app times every walk and run and tells you exactly when to switch. |
   | `lock.fill` / `lock` | Private and Free | No account, no ads, no tracking — everything stays on your phone. |
4. **Health footnote** — the small block above the button (Apple Games'
   privacy-footnote position): small tinted `heart.text.square` symbol +
   footnote-size secondary text: "Couch to 5K is designed for beginners. If you
   have a health condition or an old injury, have a quick word with your doctor
   before starting — and listen to your body."
5. **Continue button** — full-width capsule labelled "Continue", Liquid Glass
   prominent tinted primary (fallbacks per decisions log). Advances via the
   existing `completeAndAdvance` wiring.

The content area (icon → feature rows) is scrollable
(`contentInsetAdjustmentBehavior="automatic"`) so small devices don't clip;
footnote + CTA stay pinned at the bottom.

## 3. Presentation

In `src/app/_layout.tsx`, the `onboarding` screen changes from
`fullScreenModal` to `presentation: 'modal'` with `gestureEnabled: false`.
Light/dark follows the existing tokens (`bg-background`,
`text-foreground(-secondary)`, `text-primary`). If pure-black `bg-background`
reads wrong against the dark reference during simulator comparison, decide
there — no new token up front.

## 4. Components (per ADR 0013)

- **`src/components/island/button.tsx`** — starts the `island/` layer:
  `IslandButton`, the one named home for the @expo/ui CTA idiom. iOS: `Host` +
  `Button` with `buttonStyle('glassProminent')` + primary `tint` when the iOS
  major version is ≥ 26 (plain `Platform.Version` check — no expo-glass-effect
  import), `borderedProminent` below. Android: renders the existing RN
  `PrimaryButton` (the inline platform fork ADR 0005 §4 expects at this seam).
  Carries `testID` — it is what Maestro taps. Exported as `IslandButton` for
  now; folds into the ADR 0013 `Island.*` compound when the island layer is
  fully adopted.
- **`src/components/feature-row.tsx`** — domain component: SF Symbol name map +
  title + description, Uniwind-styled, `SymbolView` used directly (no `ui/`
  symbol wrapper — YAGNI).
- **`src/components/onboarding-step-screen.tsx`** — evolves: scrollable content
  area, new optional `footnote` slot, CTA pinned at the bottom via
  `IslandButton`, keeps `completeAndAdvance` wiring and testIDs.
- **Routes** — `src/app/onboarding/index.tsx` recomposed;
  `how-it-works.tsx` and `health-note.tsx` deleted.
- No `cn.ts`/cva scaffolding — nothing here carries variants; full ADR 0013
  adoption stays out of scope.

## 5. Dependencies

One new first-party dependency: **`expo-symbols`**, installed with
`bun expo install expo-symbols`. Verify Android Material Symbols support at
implementation time; if absent on SDK 57, rows render icon-less on Android
(secondary target) rather than pulling another dependency.

`expo-glass-effect` is **not** needed — `@expo/ui` covers the glass button.

## 6. Services & data

- `ONBOARDING_STEPS` in `src/services/onboarding.ts` shrinks to
  `[{ id: 'welcome-v1', route: '/onboarding' }]`. Mid-onboarding installs that
  completed `welcome-v1` but not the later steps skip onboarding entirely —
  acceptable (dev/test installs only).
- `onboarding-store`, `OnboardingGate`, and the completed-steps storage format
  are unchanged.

## 7. Testing & verification

- **Unit:** `bun test` — onboarding service tests updated for the single-step
  list.
- **Maestro:** onboarding flow shrinks to one Continue tap; the
  `onboarding-continue-welcome` testID survives on the island button. Full
  suite locally before merge (policy).
- **Argent (iOS simulator):** verify light **and** dark against the two
  reference screenshots (side-by-side comparison); confirm the sheet framing,
  glass rendering on iOS 26, and scroll behavior on a small device profile.
  Android emulator sanity check of the fallback button.

## 8. Out of scope

- Permission-request onboarding steps (future stages; the stack structure is
  ready for them).
- Full ADR 0013 component-layer adoption (`ui/` primitives, `cn.ts`, cva).
- Restyling `run-summary`'s `PrimaryButton` usage (it stays as-is; reused as
  the Android fallback).
