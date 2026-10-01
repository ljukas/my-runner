# Free run — stage 3c: the Run tab

Date: 2026-09-30
Spec: [free-run design](../specs/2026-09-29-free-run-design.md) §5.1 · ADR:
[0026](../../adr/0026-free-run-open-mode-motion-buckets.md) (2026-09-30 stage-3c amendment) ·
follows 3b (#86, merged), precedes 4

## Goal

Planned runs and free runs are equal ways in. The Plan tab becomes the Run tab, whose root is a
chooser of two native-feeling cards; the week list moves one screen in. A header icon was the only
way into a free run, and a tab named "Plan" said free runs did not belong there.

## Owner decisions (2026-09-30)

- A chooser, not one screen mixing both ("I don't want them to be mixed"), native on each platform
  and not a pure list; the two platforms are not 1:1.
- **Couch to 5K card**: its body pushes the week list; an "Up next" button opens that session's
  `session/[key]` sheet directly. When the plan is complete the card says so and the button goes;
  the body still opens the list.
- **Free run card**: opens the `/free-run` sheet; no button of its own.
- Delivery: this stage, between 3b and 4, one PR.

Defaults stated to the owner and kept: the header entry, `FreeRunHeaderButton` and the Android
layout fork go; every start (the Up next button, the free-run card, the week list's rows) waits on
the resume gate, and browsing the list does not; the not-saved notice moves to the chooser; the tab
keeps `figure.run` / `directions_run`, the cards get `calendar` / `calendar_month` and
`figure.run` / `directions_run`.

## Design

- **Pure** (`bun test`): `domain/plan-progress.ts` — `planProgress` (weeks, counts, next session,
  the completed set) replaces the grouping both list forks did inline; `weekTitle`,
  `planCardDetail`, `nextRunLabel`. The free-run card's copy is `FREE_RUN_CARD` in
  `domain/free-run-view.ts` (replacing `FREE_RUN_ENTRY_LABEL`).
- **Hooks**: `usePlanProgress` (active plan × completed runs, the one live query) and `useRunEntry`
  (replaces `useFreeRunEntry`: the gate plus `openPlan`, `openSession`, `openFreeRun`).
- **Component**: `RunModeCard` with `RunModeCard.List`, an `.ios`/`.android` pair with identical
  props (ADR 0013). The header and the action are siblings, never nested, so one tap never fires
  both.
  - iOS: a SwiftUI `ScrollView` of cards on the grouped background — a `plain` header `Button`
    (symbol, title, detail, chevron), a `ProgressView`, and `Island.Button` for the action (glass
    on iOS 26). Not a `List`: two buttons in one row both fire.
  - Android: Material 3 filled `Card`s in a scrolling `Column` — the plan card on
    `primaryContainer` with a Cookie6 hero, free run on `surfaceContainerHigh` with a Clover4 one,
    a `LinearProgressIndicator`, and a filled button. Only the header row is `clickable`, so TalkBack
    reads the button on its own.
- **Routes**: `(tabs)/(index)/index.tsx` is the chooser and platform-blind (the fork lives in
  `RunModeCard`), so `index.android.tsx` is gone; the week list is `plan.tsx` + `plan.android.tsx`
  (moved), titled "Couch to 5K"; one `_layout.tsx` serves both platforms. `tsconfig.android.json`
  excludes `plan.tsx` instead of `index.tsx`.
- `RunNoticeRow` on iOS is a plain `Island.Text` now that it sits in a `VStack`, not a `List`; the
  week list shows it too, in its own `Section` (iOS) or as the first `LazyColumn` item (Android).
- Review round, owner answers: `useStartRun` returns early while the resume gate is not clear and
  both sheets disable Start with it; the Run stack anchors on `index`; every `router.push` in the
  app became `router.navigate` (AGENTS.md now says so: `push` only where a duplicate must stack).

## E2E

New helpers: `assert-run-home` (the landing anchor `Couch to 5K.*`, the same in every plan state),
`open-run-tab` (tap "Run" from another tab — on the Run tab the large title is "Run" too) and
`open-plan`. `start-w1d1` taps "Up next: Week 1 · Day 1" once it is enabled; `start-free-run`
retries its tap on "Free run.*", because a disabled Compose card drops its click handler rather
than reporting disabled. The `Week 1 ·.*` landing assertions in `complete-onboarding`,
`onboarding`, `location-primer-allow`/`-deny`, `health-primer-skip` and `run-lock` become
`assert-run-home`, and `run-abandon`'s relaunch wait anchors on `Couch to 5K.*` directly;
`location-jit-ask` reaches the chooser through `open-run-tab`; `complete-session` checks "Up next: Week 1 · Day 2" on the chooser and
keeps `plan-next-w1d2` on the list; `free-run` checks "Week 1 · 0/3" through `open-plan`.

## Verified on device (2026-09-30)

- iOS 26.5 (iPhone 17 Pro Max) and Android API 37 (Pixel 10 Pro): header, action and free-run card
  are three separate accessibility elements; each tap does only its own thing (list push, session
  sheet, free-run sheet).
- iOS: the large title collapses under a SwiftUI `ScrollView` inside the Host (the risk that
  decided pure SwiftUI over an RN root) and comes back on return; at AX3 text the action wraps and
  the last card clears the tab bar; dark mode.
- Android: at font scale 2.0 both cards fit above the navigation bar; dark mode follows the
  wallpaper palette; back returns from the list.
- The "Too short to save" notice appears above the cards after a free run ended under a minute.
