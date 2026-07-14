# Session Sheet Redesign — Design Spec

**Date:** 2026-07-14
**Status:** Approved pending final user review
**References:** In-app screenshot of the current `session/[key]` form sheet (provided 2026-07-14); palette exploration artifact "Beacon" (4 signal-flag options + mixes)

## 1. Overview

Tapping a run on the plan list opens the session sheet (`src/app/session/[key].tsx`,
a `formSheet` route). It has four problems, all addressed here:

1. **It doesn't fit its content** — the sheet is pinned open at half-height, leaving a
   large empty gap below the button.
2. **The colors are flat and the segment palette is weak** — content floats on a plain
   white/black surface with no grouping, and the four segment hues have poor contrast
   (run-blue and cool-down-blue are nearly identical).
3. **There is no plain-language description of the run** — the user only sees a bar and
   raw stats, not "what am I about to do".
4. **The Start button is content-width and left-aligned** — it should span the sheet.

The redesign keeps the sheet's information but restructures it: a one-line summary under
the title, a single grouped card holding the segment bar + a new legend + the stats (now
including a **Walking** total beside **Running**), and a full-width primary button. The
sheet sizes to its content. The segment palette is replaced with **Beacon**, a
high-contrast signal-flag palette.

### Decisions log (agreed 2026-07-14)

| Topic | Decision |
|---|---|
| Sheet height | `sheetAllowedDetents: 'fitToContents'` (verified valid for expo-router SDK 57 `Stack.Screen` form-sheet options); drop `sheetInitialDetentIndex`; keep grabber |
| Visual structure | One grouped card (`bg-background-element`, rounded) wrapping segment bar + legend + hairline + stats; summary line above the card; keeps existing theme tokens |
| Segment palette | **Beacon** — warm-up `#FF7A00`, run `#3c87f7` (app primary, unchanged), walk `#FFC400`, cool-down `#00B39A` |
| Summary copy | Precise phrasing for uniform weeks, generic fallback for the three irregular weeks (W3, W4, W6D1); single continuous-run weeks get their own phrasing |
| Stats | Add **Walking** (walk seconds, excludes warm-up/cool-down) beside **Running**; four rows: Total / Running / Walking / Completed |
| Stat legibility | Stat **values stay in the legible foreground token — not tinted** with segment colors (walk-yellow on the card fails contrast). The legend above the stats carries the colour mapping |
| Button | Existing `Island.Button` `fill` path (full-width via SwiftUI label-frame trick) |
| Legend | New `SegmentLegend` component; shows only the kinds present in the session (single-run weeks show no "Walk") |
| Run screen fallout | `SegmentColors` is shared with `run.tsx`, which colours the segment **name text** with it. Beacon's walk-yellow (and, already today, warm-up/cool-down) is illegible as text on the plain background — so the run-screen segment label moves to the standard foreground token; the gauge below it keeps the segment tint as the colour cue |

## 2. Sheet layout (top → bottom)

Rendered inside the form sheet, sized to content:

1. **Title** — `Text variant="subtitle"`, e.g. `Week 2 · Day 1` (`sessionTitle`), unchanged.
2. **Summary line** — `Text tone="secondary"`, the new `sessionSummary(session)` string
   (§4). One line, muted.
3. **Grouped card** — `View className="gap-4 rounded-2xl bg-background-element p-4"`:
   - `SegmentBar` (unchanged component; recoloured via the palette).
   - `SegmentLegend` (§5) — swatch + label per present kind.
   - Hairline — `View className="h-px bg-background-selected"`.
   - `StatList` (existing compound) with four `StatList.Row`s: Total, Running, **Walking**,
     Completed. Values in the default foreground token (no tint).
4. **Start button** — `Island.Button` with `fill` (§3).
5. **Bottom inset** — safe-area bottom padding via `useSafeAreaInsets()` so the button
   clears the home indicator.

The root `View` drops `flex-1` (it must take intrinsic height for `fitToContents`) and keeps
`gap-6 bg-background px-6 pt-8` plus the bottom inset.

## 3. Fit to content + full-width button (issues 1 & 4)

**Sheet (`src/app/_layout.tsx`):** on the `session/[key]` `Stack.Screen`, replace
`sheetAllowedDetents: [0.5, 0.95]` + `sheetInitialDetentIndex: 0` with
`sheetAllowedDetents: 'fitToContents'`. Keep `presentation: 'formSheet'` and
`sheetGrabberVisible: true`. Confirmed against Expo SDK 57 docs: `sheetAllowedDetents`
accepts `number[] | 'fitToContents'`.

**Button:** add the `fill` prop to the existing `Island.Button` call. No new code — the
`fill` branch already renders an `IslandHost` at `width: '100%'` and uses the SwiftUI
label-frame trick to make the capsule span the width. On Android it falls through to the
RN pill (`ui/Button`), which is full-width by default in a column.

## 4. Run summary (issue 3)

New pure-domain code in `src/domain/format.ts`, unit-tested with `bun test` (no RN runtime):

- `durationWords(seconds)` — `seconds % 60 === 0 ? "${seconds/60}-minute" : "${seconds}-second"`.
  (`90 → "90-second"`, `120 → "2-minute"`, `300 → "5-minute"`, `1200 → "20-minute"`.)
- `sessionSummary(session)` — splits off the leading warm-up and trailing cool-down, then
  describes the core intervals:
  - **Single continuous run** (core is one `run`): `One continuous {durationWords} run.`
  - **Uniform alternating** (core strictly alternates run/walk, starts and ends on a run,
    all runs equal, all walks equal; `n` = run count): `Alternates {runWords} runs with
    {walkWords} walks, {n} times.`
  - **Irregular fallback** (anything else — W3, W4, W6D1): `{runCount} run intervals with
    walk recovery · {formatMinutes(totalRunSeconds)} running.`

Warm-up and cool-down are always 5 min and are conveyed by the bar + legend, so the
sentence stays focused on the core intervals.

### Expected output (test matrix)

| Session | Segments (core) | Summary |
|---|---|---|
| W1 (`alternate(8,60,90)`) | 8× run 60 / walk 90 | `Alternates 1-minute runs with 90-second walks, 8 times.` |
| W2 (`alternate(6,90,120)`) | 6× run 90 / walk 120 | `Alternates 90-second runs with 2-minute walks, 6 times.` |
| W5D1 | run300/walk180 ×3 | `Alternates 5-minute runs with 3-minute walks, 3 times.` |
| W5D2 | run480/walk300 ×2 | `Alternates 8-minute runs with 5-minute walks, 2 times.` |
| W5D3 | run 1200 | `One continuous 20-minute run.` |
| W6D2 | run600/walk180 ×2 | `Alternates 10-minute runs with 3-minute walks, 2 times.` |
| W3 | run 90/180/90/180 | `4 run intervals with walk recovery · 9 min running.` |
| W4 | run 180/300/180/300 | `4 run intervals with walk recovery · 18 min running.` |
| W6D1 | run 300/480/300 | `3 run intervals with walk recovery · 18 min running.` |
| W7–9 | run 1500/1680/1800 | `One continuous 25-/28-/30-minute run.` |

## 5. Colors: Beacon palette, legend, and the shared-token legibility fix (issue 2)

### Palette

Replace `SegmentColors` in `src/constants/theme.ts` (same values in both schemes, as today):

| Kind | Old | Beacon |
|---|---|---|
| warmup | `#F5A623` | `#FF7A00` |
| run | `#3c87f7` | `#3c87f7` (unchanged) |
| walk | `#8E8E93` | `#FFC400` |
| cooldown | `#5AC8FA` | `#00B39A` |

Run stays the app primary blue; run ↔ walk (the most-repeated adjacency) becomes
blue ↔ yellow, the most legible pairing. Exact hues will be sanity-checked live on the
simulator in both themes.

### Card + legend

- The segment bar, legend, hairline, and stats live in one `bg-background-element`
  rounded card, giving the flat sheet the structure it lacks (reuses existing tokens).
- **`SegmentLegend`** — new `src/components/segment-legend.tsx` (domain component per ADR
  0013; screens compose only). Props: `segments: PlannedSegment[]`. Renders a
  `flex-row flex-wrap` of items, one per **distinct kind present**, in canonical order
  (warmup → run → walk → cooldown): a rounded colour swatch (`SegmentColors[kind]`, a fill
  — legible) + the `SEGMENT_KIND_LABEL[kind]` in a secondary tone. Single-run weeks
  correctly omit "Walk".

### Stats: add Walking

- `src/domain/plan.ts` — add `sessionWalkSeconds(session)` mirroring `sessionRunSeconds`
  (`filter(kind === 'walk')`).
- Session sheet stats become four rows: Total / Running / Walking / Completed. **Running**
  and **Walking** together let a user see the plan shift week over week (running climbs,
  walking drops) at a glance. Values use the default foreground token — **not** tinted with
  the segment colour: walk-yellow as text on the card fails contrast, and the legend
  directly above already maps the colours.

### Run-screen legibility (shared `SegmentColors`)

`run.tsx` uses `SegmentColors[kind]` both as the `Gauge` tint (a fill — fine) and as the
`foregroundColor` of the large segment-name text (`run.tsx:65`). Beacon's walk-yellow as
text on the plain `bg-background` is ~1.4:1 (illegible in light mode); warm-up and
cool-down already fail similarly today. Fix: the segment-name label uses the standard
foreground colour (legible in both themes); the gauge keeps the segment tint as the colour
cue. This is a small, deliberate change to the run screen — a direct consequence of the
shared palette that also removes a pre-existing latent illegibility.

## 6. Files touched

| File | Change |
|---|---|
| `src/app/_layout.tsx` | `session/[key]` detents → `'fitToContents'` |
| `src/domain/format.ts` | add `durationWords`, `sessionSummary` |
| `src/domain/plan.ts` | add `sessionWalkSeconds` |
| `src/constants/theme.ts` | `SegmentColors` → Beacon |
| `src/components/segment-legend.tsx` | **new** legend component |
| `src/app/session/[key].tsx` | summary line, grouped card, legend, Walking stat, `fill` button, content sizing + bottom inset |
| `src/app/run.tsx` | segment-name label → foreground token (keep gauge tint) |
| `src/domain/format.test.ts` | tests for `durationWords` + `sessionSummary` (matrix in §4) |
| `src/domain/plan.test.ts` | test for `sessionWalkSeconds` |

## 7. Testing & verification

- **Unit (`bun test`):** the §4 summary matrix (all three branches + duration formatting)
  and `sessionWalkSeconds`.
- **Static:** `bun run typecheck` and `bun run lint` clean.
- **Simulator (Argent):** open the sheet and verify fit-to-content height, grouped card,
  Beacon palette, legend (present-kinds only), summary line, Walking stat, and full-width
  button — across a uniform week (W2), a single-run week (W5D3, no "Walk" in legend), and
  an irregular week (W3). Check both light and dark. Screenshot before/after. Also open the
  run screen to confirm the segment-name label is legible for a walk segment in light mode.
- **E2E (Maestro):** run the `session`-tagged flow. Selectors are text-first (ADR 0016);
  the added summary line and legend introduce new visible text but shouldn't collide with
  existing anchors — confirm, and update any selector that now matches ambiguously.

## 8. Out of scope

- No change to the run engine, plan data, persistence, or navigation.
- No new palette/token infrastructure (no separate "text-legible" segment palette); the
  run-screen label simply uses the existing foreground token.
- No change to the plan-list screen or other stat surfaces (run-summary, settings) beyond
  what the shared `SegmentColors` recolour implies (gauge/segment fills only).
