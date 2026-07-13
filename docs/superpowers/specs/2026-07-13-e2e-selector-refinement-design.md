# E2E selector refinement — text-first Maestro flows

**Date:** 2026-07-13
**Status:** Approved

## Problem

The Maestro suite targets `testID`s almost everywhere. Maestro's own guidance
(and ours) is the opposite: target user-visible text so tests validate what the
user actually sees, and treat `id` as an escape hatch for icons, images, and
third-party UI. The id-first style also forces app-code noise (testIDs on every
interactive element, `HStack` wrappers that exist only to surface a testID on a
SwiftUI `Text`).

Sources: Maestro selector guide (`how-to-use-selectors`), relational-selectors
and `scrollUntilVisible` references, and the test-architecture/tags guides on
docs.maestro.dev.

## Decision drivers

- Tests should read as user journeys and break when user-visible behavior breaks.
- IDs remain only where text targeting is genuinely impossible.
- Suite structure follows Maestro's journey-based layout with tags for targeted runs.
- App code keeps a testID only if a test still needs it.

## Selector policy

1. **Text first.** Every tap and assert targets visible copy. `text` matching is
   an anchored regex — use patterns (`Week 1 ·.*`, `Workout complete.*`) for
   dynamic strings.
2. **Screen-identity asserts.** Before tapping a screen's CTA, assert that
   screen's unique heading (e.g. `How it works` before its `Continue`). This
   disambiguates repeated CTA labels across consecutive screens.
3. **Disambiguate repeats** with `index` (or relational selectors) — e.g.
   `Day 1` repeats across week sections; the first match is Week 1's.
4. **`scrollUntilVisible`** wraps taps/asserts on elements inside scrollable
   lists (plan rows, history rows). It is a no-op when the element is already
   visible, and makes flows device-size-independent.
5. **IDs are escape hatches**, each documented with a comment at the use site
   and listed in the registry below.

## Escape-hatch registry

| Target | Why text can't work |
| --- | --- |
| `id: xmark` (dev-launcher intro sheet) | Third-party Expo UI, icon-only close button; its `Continue` label collides with the onboarding CTA behind the sheet |
| `plan-next-*` testID (next-session arrow) | Icon with no text — Maestro's documented "icons → id" case |
| `point: "85%,27%"` (Compressed plan toggle glyph) | Known geometry quirk: the merged row element only registers touches on the switch glyph, not at its center |
| `settings-compressed-plan` testID | **Conditional** — kept only if `checked: true` cannot be asserted via `text: "Compressed plan"` (verified live during implementation; the id and text address the same merged element, so text is expected to work) |

## Flow rewrites

Exact visible strings, from the screens' source:

- Onboarding: a single welcome step (collapsed to one screen after this spec
  was drafted) — assert `Welcome to`, tap the one `Continue`; landing asserted
  via the `Week 1 ·.*` section header.
- Relaunch persistence (onboarding flow): `assertNotVisible: "Welcome to"`
  (the welcome screen's unique heading — verified live), `assertVisible:
  Week 1 ·.*`.
- Plan → session: `scrollUntilVisible` + `tapOn: { text: "Day 1", index: 0 }`;
  session sheet asserted via `Week 1 · Day 1`, started via `Start session`.
- Run screen: first-segment label (`Warm up` — verified live against the
  compressed plan), controls via `Pause` / `Resume` / `Skip` / `End`,
  confirmation dialog via `End run`, paused state via `Resume`.
- Summary: `extendedWaitUntil` on the real headline — `Workout complete.*`
  (completed) or `Good effort!` (partial) — then `Done`.
- History: `Week 1 · Day 1` row title, `Partial` badge.
- Tabs: `Plan`, `History`, `Settings` (already text today).
- Next-session progression: `assertVisible: { id: "plan-next-w1d2" }`
  (escape hatch, icon-only).
- `helpers/open-dev-server.yaml` is already text-based (`.*8087.*`) plus the
  `xmark` escape hatch — unchanged apart from comments.

## Suite structure

```
.maestro/
├── config.yaml          # flows: ["tests/*.yaml"]
├── tests/
│   ├── onboarding.yaml        # tags: [onboarding]
│   ├── complete-session.yaml  # tags: [session]
│   └── run-controls.yaml      # tags: [session]
└── helpers/                   # unchanged names, not discovered as flows
```

- Numeric prefixes drop: flows are independent (each starts with
  `clearState: true`), so ordering carries no meaning.
- Tags enable targeted dev runs (`maestro test --include-tags session .maestro/`).
- `.maestro/` stays the suite root, so ADR 0001's EAS `flow_path`
  compatibility note still holds.

## App-code cleanup

Strip every testID no test uses after the rewrite:

- `src/app/onboarding/*` + `src/components/onboarding-step-screen.tsx`
  (`onboarding-continue-*`, and the now-dead `buttonTestID` prop)
- `src/components/primary-button.tsx` (`testID` prop), `src/app/run-summary.tsx`
  (`summary-done`)
- `src/app/run.tsx` (`run-pause`, `run-skip`, `run-end`, `run-keep-awake`;
  `run-countdown` / `run-elapsed` including their `HStack` wrappers, which
  existed only to surface the testID — unwrap and visually verify no layout
  change)
- `src/app/(tabs)/index.tsx` (`plan-row-*`; **keep** `plan-next-*`)
- `src/app/(tabs)/history.tsx` (`history-row-*`)
- `src/app/(tabs)/settings.tsx` (`settings-reset-onboarding`;
  `settings-compressed-plan` per the registry condition)
- `src/app/session/[key].tsx` + `src/components/segment-bar.tsx`
  (`session-start`, `session-segment-bar`, and the `testID` prop)

## Documentation

- **AGENTS.md** E2E section: rewrite the authoring guidance around the
  text-first policy and escape-hatch registry; keep the SwiftUI
  testID-on-bare-`Text` quirk as a general note (it still governs future
  escape hatches); update the compressed-plan bullet for the text-based
  `checked` assertion.
- **ADR 0016 — Text-first Maestro selectors:** short ADR recording the policy,
  added to the AGENTS.md ADR list.
- ADR 0001 is untouched (it governs where/when tests run, not selectors).

## Verification

1. Author against the running app: booted iOS simulator, dev-client build,
   Metro on 8087; read real element text/traits with Maestro MCP
   `inspect_screen` — no guessed strings.
2. Full suite green locally: `maestro test .maestro/`.
3. Visual check (Argent screenshot) after the run-screen `HStack` unwrap.
4. `bun run lint`; `grep -rn testID src/` shows only the surviving escape
   hatches.

## Out of scope

- No new test coverage, no Android runs, no EAS workflow changes.
- Argent record/replay flows unaffected (ADR 0001's tool split unchanged).
