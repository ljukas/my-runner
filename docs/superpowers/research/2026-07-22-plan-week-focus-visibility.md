# Plan screen: focus the current week (de-emphasize, collapse & hide completed weeks) — research

Date: 2026-07-22
Status: **research / Researched** — not a decision to build.

**Question:** On the Plan list (`src/app/(tabs)/(index)/index.tsx`), can we — on our
stack — de-emphasize completed weeks and push them to the bottom to keep focus on the
next week to run, *and* let the user manually hide/unhide a week (for someone
migrating mid-program from another app), using SwiftUI-native list affordances, while
staying fully local?

## TL;DR

- **Feasibility:** `Feasible-with-caveats` — every piece exists in the pinned `@expo/ui`
  57.0.7 and is documented with working examples (native `Section` collapse,
  `DisclosureGroup`, `SwipeActions`, `List.ForEach` edit-mode, and the styling
  modifiers). The de-emphasize-and-reorder core is unconditional pure JS. The caveats
  are all design/spike, not blockers: these specific collapse/swipe components are
  first-use in this repo (a UI spike is the ADR's first task), native `Section` collapse
  forces the whole list into `sidebar` style, and manual-hide collides with the "next
  up" logic in a way the ADR must resolve.
- **Local-first fit:** `Fully local` — pure UI + a small persisted "hidden weeks" set in
  the existing `expo-sqlite/kv-store` seam. No network, no accounts, no analytics, no
  schema migration. Holds the AGENTS.md line trivially.
- **Recommended approach:** Ship the zero-risk **baseline** always-on (reorder completed
  weeks to the bottom + gray them via modifiers), then add **native collapse** — front-
  runner `DisclosureGroup` so the list keeps its current inset-grouped look — and a
  **manual hide/unhide** via `SwipeActions` or a `ContextMenu`, persisted to kv-store.
  This is an assessment, not a commitment; the collapse-mechanism pick and the
  hide-vs-"next up" semantics belong in an ADR after a short on-device spike.

## Context

The Plan screen renders the active C25K plan as a SwiftUI `List` of per-week `Section`s,
each holding day rows (`Button`s) — see `src/app/(tabs)/(index)/index.tsx`. It already
computes `completedKeys` (from recorded runs via `useLiveQuery`), `nextSessionKey`
(`@/domain/plan`), and the per-week `done/total`. As the program progresses, completed
weeks accumulate at the top and bury the one week that matters — the next one to run.

Two behaviors are wanted:

1. **Auto de-emphasis + reorder** — a completed week (all its sessions have a recorded
   run) is grayed and moved below the active/upcoming weeks, so the next week stays in
   focus. Optionally collapsed to reclaim vertical space.
2. **Manual hide/unhide** — someone who did Week 1 and half of Week 2 in another app,
   then finishes the remaining Week-2 days here, can hide the weeks they never logged
   in-app. This is a *user override*, distinct from (1): those weeks never reach
   "all sessions completed" in our data (the earlier days have no run row), so auto-logic
   alone will never de-emphasize them.

ADRs / subsystems in scope (cited, not re-litigated):

- **[ADR 0005](../../adr/0005-system-native-ui-expo-ui.md)** — screens are SwiftUI islands
  via `@expo/ui`; the Plan list is exactly this. Any native list affordance must come from
  `@expo/ui`'s exposed surface.
- **[ADR 0013](../../adr/0013-component-design-conventions.md)** — screens *compose only*;
  new idioms wrap into `src/components/island/` (or `ui/`), not inline in the screen. A
  collapsible-week wrapper and a hide affordance would land as island/primitives.
- **[ADR 0004](../../adr/0004-local-storage-expo-sqlite-drizzle.md)** — on-device storage.
  UI/preference state (like settings & onboarding) already persists through the
  `expo-sqlite/kv-store` seam (`src/services/storage.ts`), *not* the runs DB; the hidden-
  weeks set fits that pattern with no Drizzle migration.
- **[ADR 0010](../../adr/0010-maps-expo-maps-ios18-floor.md)** — the app's iOS deployment
  floor is **18.0**, so the iOS-17-only `Section` collapse is safely available.
- **[ADR 0020](../../adr/0020-ios-only-android-deferred.md)** — iOS-only today; `SwipeActions`
  is iOS-only and `Section` collapse is iOS/tvOS, which is fine now and consistent with the
  island fork model (ADR 0005 §4) for any future Android pass.

Inherited AGENTS.md hard constraints: no backend/accounts/analytics; on-device + iCloud;
iOS-primary. This feature touches none of them — it is presentation plus one local flag.

## Findings

Capability facts are grounded first in the **installed** `@expo/ui@57.0.7` type surface
(the version pinned on `main`, `~57.0.7` in `package.json`), then corroborated against the
official Expo docs. All verified 2026-07-22.

- **`listStyle` modifier already ships and is already used here.** The `log` screen sets
  `listStyle('automatic')` (`src/app/(tabs)/log/index.tsx:70`). The type union is
  `ListStyle = 'automatic' | 'plain' | 'inset' | 'insetGrouped' | 'grouped' | 'sidebar'`
  (`node_modules/@expo/ui/build/swift-ui/modifiers/index.d.ts:1145`). So `'sidebar'` is a
  first-class value.
- **Native collapsible `Section` — but only under `sidebar` style, iOS 17+.**
  `Section` exposes `isExpanded?` + `onIsExpandedChange?`; the type comment reads *"When
  provided, the section becomes collapsible… Available only when the list style is set to
  `sidebar`… @platform ios 17.0+"* (`.../swift-ui/Section/index.d.ts`). The official docs
  confirm with a full example — `<List modifiers={[listStyle('sidebar')]}>` wrapping
  `<Section isExpanded onIsExpandedChange>` — and add that **footers are not supported for
  collapsible sections** ([Section docs](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/section),
  verified 2026-07-22). Consequence: turning on native `Section` collapse restyles the
  *entire* Plan list into the source-list "sidebar" look, not just the completed weeks.
- **`DisclosureGroup` — native collapse with no list-style constraint.** Exposes
  `label?`, `isExpanded?`, `onIsExpandedChange?`, and a `DisclosureGroup.Label` slot
  (`.../swift-ui/DisclosureGroup/index.d.ts`). Docs: *"the primary component for creating
  expandable and collapsible content sections with a disclosure indicator… typically used
  within a Form to provide standard iOS list styling"*
  ([DisclosureGroup docs](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/disclosuregroup),
  verified 2026-07-22). This gives chevron-collapse while keeping the app's existing
  inset-grouped aesthetic — at the cost of restructuring weeks from `Section`s into
  disclosure groups.
- **`SwipeActions` — native swipe-to-reveal buttons, iOS.** `SwipeActions` wraps a content
  node; `SwipeActions.Actions` takes `edge: 'leading' | 'trailing'` and
  `allowsFullSwipe?` and holds `Button`s (incl. `role="destructive"`)
  (`.../swift-ui/SwipeActions/index.d.ts`; [SwipeActions docs](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/swipeactions),
  verified 2026-07-22). This is the natural "swipe → Hide" affordance. Note SwiftUI swipe
  actions are **row-level**, not section-level — see the open question on where a
  *whole-week* hide lives.
- **`List.ForEach` edit-mode: native `onDelete` + `onMove`.** `List.ForEach` exposes
  `onDelete(indices)` and `onMove(source, dest)`; the docs' example toggles edit state
  with `environment('editMode', 'active' | 'inactive')` and tags rows with `tag(id)`
  ([List docs](https://docs.expo.dev/versions/latest/sdk/ui/swift-ui/list), verified
  2026-07-22). Per-row `deleteDisabled(_:)` / `moveDisabled(_:)` modifiers also exist.
  This is an alternative hide/reorder mechanism (familiar iOS Edit mode) — heavier UI than
  swipe, and `onDelete` reads as "Delete," so for a non-destructive hide the custom
  `SwipeActions` button is a better fit than repurposing `onDelete`.
- **Graying-out is pure modifiers.** `opacity`, `grayscale`, `disabled`, and
  `foregroundStyle({ type: 'hierarchical', style: 'secondary' | 'tertiary' })` are all in
  the modifier registry (`.../modifiers/index.d.ts`) — the current row already uses
  `Island.Text tone="secondary"`. No native list feature needed to de-emphasize.
- **Reordering is pure JS.** The screen derives `weeks` from `plan.map(s => s.week)`;
  sorting so weeks whose sessions are all in `completedKeys` come last is a few lines of
  domain logic (`@/domain/plan`), independently unit-testable with `bun test` and needing
  no RN runtime.
- **Persistence is the existing kv-store seam.** Settings/onboarding/active-plan persist a
  JSON blob through `StringStorage` (`getItemSync`/`setItemSync`) with a `create*Store`
  factory + a `use*` hook (`src/services/settings.ts`, `storage.ts`). A `hiddenWeeks:
  number[]` (or a small `plan-view` store) slots in identically — fully local, corruption-
  safe (`readJson` returns `null` on bad JSON), no migration.
- **These components are first-use in this repo.** A grep of `src/` finds no existing use
  of `DisclosureGroup`, `SwipeActions`, `isExpanded`, `List.ForEach`, `onDelete`, or
  `onMove`; only `listStyle` is already used. So the collapse/swipe behavior is documented
  but not yet runtime-proven *here* — hence the recommended on-device spike.

## Options

All three share the same **always-on baseline** (JS reorder of completed weeks to the
bottom + gray via modifiers) and differ only in the *collapse* mechanism and how *manual
hide* is triggered. Manual-hide state persists to kv-store in every option, with a "Show N
hidden weeks" affordance to reveal.

### Option A — De-emphasize + reorder, swipe-to-hide (no collapse)
Completed weeks are grayed and sorted to the bottom; they stay fully visible until the
user hides one. Manual hide via a `SwipeActions` "Hide" button on the week (attached to a
week-header row). Least native surface, keeps the current inset-grouped list style
verbatim, smallest structural change.
*Trade-off:* completed weeks still occupy full height until hidden — the "reclaim space"
goal is only met by hiding, not by collapse. Swipe actions are row-level, so hiding a
*whole week* needs a dedicated header row to swipe (see open questions).

### Option B — Collapsible "completed" via `DisclosureGroup` (front-runner)
Baseline reorder/gray, plus completed weeks auto-collapse: either each completed week
becomes a `DisclosureGroup` (collapsed by default), or all completed weeks fold under one
"Completed weeks" group. Keeps the app's standard inset-grouped styling (no list-style
change). Manual hide via `SwipeActions` or a `ContextMenu` on the group label.
*Trade-off:* restructures weeks from `Section` to `DisclosureGroup` (a component designed
to live inside a `Form`/`Section`), so the day rows nest one level deeper; first-use of the
component in this repo → spike.

### Option C — Per-week collapsible `sidebar` Sections
Set `listStyle('sidebar')` and give each week `isExpanded`/`onIsExpandedChange`: completed
weeks collapsed and sorted to the bottom, the next week expanded. Maps 1:1 onto the current
per-week `Section` structure — the smallest *structural* diff (Sections just gain the two
props). Manual hide via `SwipeActions`/`ContextMenu`, persisted.
*Trade-off:* `sidebar` restyles the **entire** Plan list into the iOS source-list look — a
visible departure from the current design and from the `log` screen's `automatic` style;
collapsible sections can't have footers. iOS 17+ (fine at our 18.0 floor). Accept the
sidebar aesthetic app-wide on this screen or don't take this option.

> **Rejected as a primary mechanism (not an option):** repurposing `List.ForEach`
> `onDelete` as "hide." It works, but the swipe reveals a red **Delete** affordance —
> wrong signal for a non-destructive, reversible hide. A custom `SwipeActions` "Hide"
> button carries the right semantics. Kept only as a fallback if section-level swipe
> proves unworkable.

## Comparison

| | A — reorder + swipe-hide | B — `DisclosureGroup` collapse | C — `sidebar` `Section` collapse |
|---|---|---|---|
| Feasibility | Feasible (pure JS + `SwipeActions`) | Feasible-with-caveats (first-use; restructure) | Feasible-with-caveats (whole-list restyle) |
| Local-first | Fully local | Fully local | Fully local |
| Battery / power | None (static UI) | None | None |
| Platform reach | iOS (swipe iOS-only) | iOS (collapse iOS/tvOS) | iOS 17+ (we floor at 18) |
| Cost | None | None | None |
| Maintenance / tooling | Official `@expo/ui`; smallest surface | Official; new component, keeps app look | Official; new prop path, changes app look |

## Feasibility assessment

**`Feasible-with-caveats`.** Buildable on Expo SDK 57 + CNG with only official tooling — no
custom native code, no config-plugin change, no new dependency (all APIs are in the pinned
`@expo/ui@57.0.7`, each documented with a runnable example). The de-emphasize + reorder
core is unconditional and pure TS. The caveats are bounded and non-blocking:

1. **First-use spike.** `DisclosureGroup`/`SwipeActions`/`Section`-collapse are documented
   but unused in this repo; the ADR's first task is a throwaway on-device spike (via the
   Argent simulator loop) to confirm the chosen collapse renders/animates well and that
   swipe works on the week rows as laid out.
2. **`sidebar` visual cost** gates Option C only — it restyles the whole list. Options A/B
   avoid it.
3. **Effort is small** — a domain reorder helper + a kv-store flag + island wrappers per
   ADR 0013 + wiring in one screen. E2E: text-first Maestro anchors (ADR 0016) shift, so
   the Plan flow's selectors need updating.

## Local-first assessment

**`Fully local`.** The whole feature is presentation plus one on-device preference (a set
of hidden week numbers) persisted through the same `expo-sqlite/kv-store` seam that already
backs settings and onboarding — no backend, no account, no analytics, no network call, and
no Drizzle schema migration (kv-store, not the runs DB). It rides iCloud's kv-store backup
for free like the other preferences. Auto de-emphasis/collapse is *derived* from existing
`completedKeys`, so it persists nothing extra. The line in AGENTS.md is untouched.

## Recommendation

Ship the **baseline** (reorder completed weeks to the bottom + gray them) always-on — it
delivers the primary "keep focus on the next week" goal with zero native risk and is
pure, testable domain logic. Layer **native collapse** on top with **Option B
(`DisclosureGroup`)** as the front-runner, because it reclaims vertical space while keeping
the app's existing inset-grouped look; fall back to **Option C (`sidebar` Sections)** only
if a spike shows the source-list aesthetic is acceptable app-wide. Provide **manual
hide/unhide** via a custom `SwipeActions` "Hide" button (or a `ContextMenu` long-press at
the week level), persisted to kv-store, with a "Show N hidden weeks" reveal. New idioms
wrap into `island/`/`ui/` per ADR 0013; the reorder logic lands in `@/domain/plan`.

> This is an assessment, not a decision to build. A build commitment — and the choice
> between the `DisclosureGroup` and `sidebar` collapse mechanisms, plus the hide-vs-"next
> up" semantics below — belongs in an ADR.

## Open questions / next steps

- **Hide vs. "next up" (the load-bearing design decision).** Manual hide exists for weeks
  the user did *elsewhere* and never logged in-app, so those sessions have no run row and
  `nextSessionKey` still points *into* a hidden week. Does hiding a week also advance the
  "next up" pointer past it (treat hidden ⇒ done for sequencing), or is hide purely
  cosmetic while "next up" ignores visibility? The migration UX only makes sense if hiding
  advances "next up" — the ADR must decide, and `@/domain/plan` sequencing may need a
  "hidden/assumed-done" input alongside `completedKeys`.
- **Where does a *whole-week* hide gesture live?** SwiftUI swipe actions are row-level. Options:
  a dedicated swipeable week-header row, a `ContextMenu` (long-press) on the header, or an
  Edit-mode toggle. Pick one in the spike.
- **Collapse mechanism:** `DisclosureGroup` (keeps look, restructures) vs `sidebar`
  `Section` (minimal restructure, restyles list). Resolve with the on-device spike.
- **Is expand/collapse state persisted or ephemeral?** Auto-collapsing completed weeks can
  be derived (no storage). If the user manually re-expands a completed week, do we remember
  that across launches, or reset to the derived default? Only the hidden-weeks set clearly
  needs persistence.
- **Reveal affordance:** a "Show N hidden weeks" list footer/row, a Settings toggle, or
  both. Also: unhiding — swipe/ContextMenu on the revealed hidden weeks.
- **Empty/degenerate states:** all weeks completed (does the list invert to a "completed"
  archive?); nothing completed yet (feature is inert, no reorder). Confirm the
  `nextSessionKey`/reorder interaction at program start and end.
- **E2E impact:** the Plan flow's text-first Maestro selectors (ADR 0016) will move; the
  `plan-next-*` id escape hatch and week-header anchors need updating in `.maestro/`.
