# 6. Every modal surface is an expo-router screen with native presentation

> **iOS-only atm** — the app currently ships iOS only (`platforms: ["ios"]`; see [ADR 0018](0018-ios-only-android-deferred.md)). The Android-specific provisions below are **deferred**, not active today — they record the intended shape of a future Android pass.

Date: 2026-07-11

## Status

Accepted

## Context

The C25K design spec (§8) needs three kinds of modal surface: a pre-run detail
sheet with detents and a grabber, a locked-down full-screen active-run modal,
and a versioned onboarding flow. The spec decided all of them are expo-router
**screens** with native `presentation` options — no component-level sheet or
modal libraries. This ADR verifies that decision against the installed stack
(expo-router ~57.0.4 over react-native-screens 4.25.2) and concretizes the
mitigation for the spec's accepted risk #5 ("formSheet behaviors vary by iOS
version").

Research findings (verified 2026-07-11):

- **The installed stack supports everything the spec needs.**
  react-native-screens 4.25.2 exposes `presentation: 'push' | 'modal' |
  'transparentModal' | 'containedModal' | 'containedTransparentModal' |
  'fullScreenModal' | 'formSheet' | 'pageSheet'`, with formSheet options
  `sheetAllowedDetents` (fractions, `fitToContents`, `medium`, `large`,
  `all`), `sheetInitialDetentIndex`, `sheetGrabberVisible` (iOS only),
  `sheetCornerRadius`, `sheetLargestUndimmedDetentIndex`, and an
  `onSheetDetentChanged` callback. `gestureEnabled` exists to disable
  swipe-dismiss. expo-router exposes these as `Stack.Screen` options and
  ships `replace`, `dismiss`, `dismissTo`, `dismissAll`, `canDismiss`.
- **Android parity is partial, by design of the underlying library:**
  formSheet maps to Material `BottomSheetBehaviour` with a **3-detent
  maximum and no headers or nested navigators inside sheets**;
  `fullScreenModal` and `containedModal` fall back to plain `modal`;
  the grabber is iOS-only; `unstable_sheetFooter` is Android-only and
  experimental.
- **formSheet has a real open-issue tail on iOS** (react-native-screens):
  `fitToContents` opening full-screen instead of fitting
  ([#2665](https://github.com/software-mansion/react-native-screens/issues/2665)),
  sheets rendering too small at lower detents on iOS 26
  ([#3235](https://github.com/software-mansion/react-native-screens/issues/3235)),
  cropped heights on stacked sheets
  ([#3569](https://github.com/software-mansion/react-native-screens/issues/3569)),
  detent jumping
  ([#1722](https://github.com/software-mansion/react-native-screens/issues/1722)).
  Fixes are actively landing through 2026 releases, but the area moves.
- Deep-linked modals require an `anchor` export in nested stack layouts to
  preserve navigation context (expo-router docs).

## Decision

**Every modal surface is an expo-router screen in the root Stack with a
native `presentation` option.** expo-router is the app's only navigation
owner — no `@expo/ui` BottomSheet, no component sheet libraries, and (per
ADR 0005) no SwiftUI-owned navigation.

Per-surface assignments and the rules that de-risk them:

1. **Pre-run detail (`session/[key]`)** — `presentation: 'formSheet'` with
   **explicit fractional detents** (e.g. `sheetAllowedDetents: [0.5, 0.95]`)
   and `sheetGrabberVisible: true`. Never `fitToContents` (broken on iOS,
   #2665). Sheet content stays flat: no nested navigator, no native header —
   which is also exactly the Android-compatible subset.
2. **Active run (`run`)** — `presentation: 'fullScreenModal'` with
   `gestureEnabled: false`; leaving mid-run goes through the explicit
   End-run confirmation only. (Android later: falls back to `modal`; a
   back-handler guard joins the Android pass.)
3. **Run summary (`run-summary`)** — entered via `router.replace` from the
   run screen so back/dismiss can never return to a finished run; Done
   dismisses to Plan (`dismissTo`/`dismissAll` are available if the stack
   deepens).
4. **Onboarding (`onboarding/`)** — `presentation: 'fullScreenModal'` over
   the tabs, hosting its own step routes.
5. **Fallback rule (pre-approved, per surface):** if a formSheet behavior
   proves unreliable on a target iOS version, that surface drops to
   `presentation: 'modal'` (native page-sheet) by changing only screen
   options — content, route, and flows untouched. Detent/grabber behavior is
   validated on device early in Stage 1 (it ships with the pre-run sheet).

## Consequences

- One navigation model: every surface is deep-linkable, participates in
  back/dismiss semantics, is addressable by Maestro as an ordinary screen,
  and is versioned in the route tree. No second sheet/modal system to learn
  or theme.
- The run → summary `replace` contract is enforceable at the router level —
  the "back into a finished run" bug class is designed out.
- We inherit react-native-screens' formSheet maturity curve. Contained by:
  explicit fractional detents only, flat sheet content, early on-device
  validation, and the per-surface `modal` fallback that changes one option.
- Android constraints are recorded now, so sheets are designed inside the
  portable subset from day one (≤3 detents, no sheet headers/nested
  navigators, no grabber). The `fullScreenModal → modal` fallback on Android
  is acceptable for both the run screen and onboarding.
- Deep links into modals need `anchor` exports in the affected layouts — an
  implementation note for Stage 1's router scaffolding.
- Screens must not assume the grabber exists (iOS-only) — it is ornament,
  not affordance: sheets remain fully usable without it.

## Alternatives considered

- **`@expo/ui` BottomSheet** (installed, official) — rejected: it creates a
  second navigation owner outside the router. Sheets presented by SwiftUI
  are invisible to deep links, router back-handling, and route-based E2E
  flows; the spec explicitly decided against it.
- **@gorhom/bottom-sheet** — rejected: community dependency (against the
  official-tooling policy) solving a problem the router already solves;
  @expo/ui even ships an official drop-in replacement for its API, which
  confirms the niche is covered without it.
- **JS-based modal presentation** (react-navigation's JS stack) — rejected:
  simulated sheets and transitions defeat the system-native-first bet
  (ADR 0005).
- **Custom `transparentModal` + Reanimated sheets** — maximum control,
  maximum code ownership; rejected for v1. `transparentModal` remains
  available for special cases without adopting it as the pattern.
