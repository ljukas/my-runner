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
  in AGENTS.md. Current registry: the dev-launcher sheet's `xmark`, the
  icon-only `plan-next-*` arrow, and the compressed-plan toggle's
  `85%,27%` point-tap.
- A `testID` exists in app code only while a flow uses it.

## Consequences

- Tests break when user-visible copy or flow structure breaks — an
  intended tripwire, since copy is part of the UX. Copy edits now touch
  flows too.
- The app is English-only; localization would reopen this decision
  (Maestro's own guidance flips to ids for localized apps).
- App components stay free of test-only props.
