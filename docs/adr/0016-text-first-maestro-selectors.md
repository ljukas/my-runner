# 16. Text-first Maestro selectors

Date: 2026-07-13

## Status

Accepted

## Context

The Stage-1 Maestro flows targeted `testID`s for almost every tap and assert.
Maestro's own guidance is the opposite: target user-visible text so tests
validate what the user actually sees; use `id` for icons, images, and
localized apps. Id-first flows also forced testIDs (and container wrappers
whose only job was carrying them) onto app components.

## Decision

- Taps and asserts target visible copy. `text` matching is an anchored
  full-match regex; dynamic strings use patterns (`Week 1 ·.*`).
- Before tapping a screen's CTA, assert that screen's unique heading —
  CTA labels repeat across screens, headings don't.
- Repeated text is disambiguated with `index` (or relational selectors);
  targets inside scrollable lists are wrapped in `scrollUntilVisible`.
- Ids are escape hatches only, each commented at the use site and listed
  in AGENTS.md. Current registry: the icon-only `plan-next-*` arrow. (The
  dev-launcher `xmark` and the compressed-plan toggle tap are gone — the
  `e2e-simulator` build defaults the compressed plan on, so flows launch
  straight into the app with no dev-server or Developer-toggle step.)
- A `testID` exists in app code only while a flow uses it.

## Consequences

- Tests break when user-visible copy or flow structure breaks — an
  intended tripwire, since copy is part of the UX. Copy edits now touch
  flows too.
- The app is English-only; localization would reopen this decision
  (Maestro's own guidance flips to ids for localized apps).
- App components stay free of test-only props.

## Amendment (2026-07-30): an icon-only native control's `accessibilityLabel` is a text-first target

The decision above left a gap that got filled with a wrong assumption. An
icon-only control has no visible copy, so flows were written as if the only
options were an id escape hatch or a coordinate gesture — `log-revisit.yaml`
dismissed the run summary with a swipe and recorded that its `xmark` "has no
text-first target", and the Stage-4 maps spec (§7.4) reasoned from that same
claim.

It is wrong for **native** controls. A `Stack.Toolbar.Button`'s
`accessibilityLabel` surfaces as that element's text, so `tapOn: "Close"`
resolves the run summary's `xmark` directly. Measured 2026-07-30: after the
summary's bottom "Done" button was removed, eight flows switched to
`tapOn: "Close"` and pass.

Consequences:

- **Prefer the label over an id or a coordinate gesture** for an icon-only
  native control. It is not an escape hatch and needs no registry entry or
  `testID` — the label is real UI, read aloud by VoiceOver, so a flow tapping it
  keeps ADR 0016's tripwire property.
- **Labels must stay distinct across stacked surfaces**, and anchored full-match
  matching is what makes that sufficient: the summary's "Close" and the route
  viewer's "Close map" never collide, even with both modals in the hierarchy.
- **This does not extend to `@expo/ui` SwiftUI `Text`**, which AGENTS.md records
  as not surfacing an id unless wrapped in a container. The amendment is about
  native controls Expo Router renders, not island content.
- A gesture-based dismissal is still worth one deliberate flow where the gesture
  is itself the affordance under test — `log-revisit.yaml` keeps its swipe for
  that reason, now that the summary has exactly two ways out.

## Amendment (2026-09-27): one flow, two platforms

Six flows now run on Android as well (ADR 0025 stage 7). Text-first held; three
Android renderings needed a wider anchor, each measured against the emulator's
hierarchy:

- **Same control, different label → alternation.** The run summary's way out is
  a toolbar `xmark` labelled "Close" on iOS and the header's up arrow, labelled
  "Navigate up", on Android: `tapOn: "(Close|Navigate up)"`, kept once in
  `helpers/close-summary.yaml`. Still an anchored full match on real, spoken
  labels, so the tripwire property survives.
- **Android merges what iOS splits → wildcards on both sides.** The Log row's status is
  one text on Android (date, status and distance joined, e.g.
  `"Sun, Sep 27 · Partial · 0.42 km"`) and a separate `"Partial"` on iOS, so Log
  assertions use `".*Partial.*"` after `helpers/open-log-row.yaml` — a leading
  wildcard alone breaks as soon as a distance follows the status. The same widening applies to an
  `assertNotVisible` — left exact, it would pass on Android without checking
  anything, which is the failure mode to watch for whenever a flow crosses
  platforms.
- **Different copy for the same step → alternation of both strings**
  (`"Your runs, in (Apple Health|Health Connect)"`).

Compose `ListItem` rows did **not** need this: Maestro sees their texts as
separate nodes, so `"Day 1"` still matches exactly. Branch a flow by platform
(`runFlow` + `when: platform`) only where the commands differ, as the launch
permissions do; a flow exercising a surface only one platform has is tagged
`ios-only` rather than branched.
