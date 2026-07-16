# Run summary: addressable route + card-dashboard redesign

**Date:** 2026-07-16
**Status:** Proposed
**Screen:** `src/app/run-summary.tsx`

## Problem

`run-summary.tsx` has two problems:

1. **It's not addressable.** At mount it reads `runEngine.getSnapshot().savedRunId`,
   so it can only ever summarise the run that just finished. The Log tab lists
   every past run, but the rows are dead — there is no way to reopen a run's
   summary. The engine snapshot is also the wrong source of truth: it couples a
   "summary" screen to live run state.
2. **The design is weak.** A static `subtitle` header, a SwiftUI `Form` that
   renders as an inset grouped list of `LabeledContent` rows, and a "Done" button
   floating well above the bottom edge (`pb-16`). It reads as a debug dump, not a
   finish screen.

## Goals

- Make the summary **addressable by run id** via a route param, so it opens from
  both the post-run flow *and* a tap on any Log row.
- Redesign it into a **card dashboard** (chosen over three alternatives in a
  visual brainstorm) that is friendly, fixed-height, and extensible.
- **Decouple** the summary from `runEngine` entirely — it becomes pure
  params + DB read.
- Leave a clean slot for the **next** feature (route map, distance, avg pace)
  without teasing it now.

## Non-goals

- The route map / GPS distance / avg pace. Those land in the following change
  (ADR 0010); the layout reserves room but ships nothing for them.
- Any change to how runs are saved or to the `runs` / `run_segments` schema.
- Reworking the Log tab beyond making its rows tappable.

## Navigation & data flow

### The route param

`run-summary` stays a root-`Stack` screen with `presentation: 'fullScreenModal'`,
`gestureEnabled: false` (unchanged registration in `_layout.tsx`). It gains two
string params (expo-router typed routes; params are always strings):

- `id` — the run to summarise. Read with
  `useLocalSearchParams<{ id?: string; celebrate?: string }>()`.
- `celebrate` — `'1'` only on a fresh finish; drives the celebratory line
  (below). Absent on a Log revisit.

The screen loads `run` + `run_segments` by `id` from the DB (the existing query,
but keyed off the param instead of the engine). Missing / not-found `id` →
the existing "This run could not be saved. Sorry about that." state.

### Two entry points

- **Post-run (run screen).** On finish, capture the id and replace:
  ```ts
  router.replace({ pathname: '/run-summary', params: { id: savedRunId ?? '', celebrate: '1' } });
  ```
  `replace` (not push) so Back never returns to the finished run. A failed save
  passes an empty `id`, which the summary renders as the apology state
  (`celebrate` is ignored on that path).
- **Log revisit (`(tabs)/log.tsx`).** Each run row becomes tappable:
  ```ts
  router.navigate({ pathname: '/run-summary', params: { id: run.id } });
  ```
  `navigate` (not push) so tapping a row twice doesn't stack duplicate modals.
  *(Implementation note: confirm the @expo/ui SDK-57 List row-tap API — likely a
  row `onPress` or wrapping the row body — against the docs before wiring; ids
  stay text-first per ADR 0016.)*

### Engine decoupling (the key structural change)

`runEngine.reset()` moves **out of** the summary and **into the run screen's
unmount cleanup**:

```ts
// run.tsx
useEffect(() => () => runEngine.reset(), []);
```

The run screen only ever leaves by finishing (it's gesture-locked; "end early"
is also a `finished` status that routes to the summary), so "run screen unmounts"
and "run is over" are the same event. Resetting on unmount flips engine `status`
to `idle` **after** the screen is gone, so it can't race the existing
`if (snapshot.status === 'idle') return <Redirect href="/" />` guard — that guard
never fires during the finish→summary transition, because `status` is
`completed`/`endedEarly` (not `idle`) right up until unmount. Calling `reset()`
inline at `replace` time was the tempting-but-fragile alternative: it would flip
`status` to `idle` while the run screen is still mounted and could bounce the user
to `/` mid-navigation.

Consequences:

- The summary imports **no** `runEngine`. It reads `id` + `celebrate` from params
  and everything else from the DB.
- "Done" is now just `router.dismissAll()` (no `reset()`). `dismissAll()` returns
  to whichever tab was active — the plan list after a run, the Log tab after a
  revisit. Correct for both, no branching.
- The engine is reset once per run regardless of save success, since unmount
  fires on every exit.

## Screen layout — card dashboard

Rendered on `bg-background`; content column with **Done pinned to the bottom
safe-area** (fixing the floating-button gripe). Content is fixed-height (the
segment breakdown is a bar, not a per-row list), so no scrolling is needed today;
wrap the content in a `ScrollView` only if/when the map pushes it past a
viewport. Respect top + bottom safe-area insets rather than the current hardcoded
`pt-24 pb-16`.

Top → bottom:

1. **Celebratory line (fresh finish only).** Shown when `celebrate === '1'`:
   `completed` → "Nice work! 🎉", `partial` → "Good effort! 💪". Omitted on Log
   revisits, so a revisit and a fresh finish are visually distinct.
2. **Header row.** Left: session title (`sessionTitle(sessionKey)` →
   "Week 1 · Day 1") over the date (`formatRunDate(startedAt)` →
   "Tue, Jul 15"). Right: a **status badge** — "Completed" (positive tone) or
   "Partial" (muted/warning tone).
3. **Stat grid (2×2).** Four tiles, each a rounded `bg-background-element` card
   with a large tabular-nums value + uppercase footnote label:

   | Tile | Value (W1D1 example) | Source |
   |------|----------------------|--------|
   | Time running | `8:00` | Σ `actualDurationS` of `run` segments |
   | Run intervals | `8` | count of `run` segments present |
   | Active time | `30:00` | `runs.activeDurationS` |
   | Longest run | `1:00` | max `actualDurationS` of `run` segments |

   Total *elapsed* time is deliberately **not** a tile — for fixed-plan runs it's
   near-predetermined and uninformative. When GPS lands, **Distance** + **Avg
   pace** are appended, growing the grid to 3×2.
4. **Segment card.** A rounded `bg-background-element` card containing the reused
   `SegmentBar` + `SegmentLegend`. Each `run_segments` row maps to the
   `PlannedSegment` shape those components take (`{ kind, seconds: actualDurationS }`),
   so the bar reflects the *actual* run shape. This replaces the old
   per-segment `actual / planned` list — a deliberate simplification; the
   aggregate tiles carry the useful numbers and the bar carries the shape.
5. **Done** — stays an `Island.Button fill label="Done"` (SwiftUI, for the
   VoiceOver/Maestro a11y reason documented in the current file: an RN pill below
   the Island host is painted but dropped from the a11y tree). Pinned to the
   bottom safe-area.

Map slot: intentionally empty now — the map card drops in above the header when
the feature exists. No "coming soon" placeholder.

## Component & domain changes (ADR 0013)

Screens compose primitives only — no file-local components, no raw RN
`Text`/`Pressable`. New/changed units:

- **`src/components/ui/badge.tsx`** (new primitive) — status pill via `cva`
  variants (e.g. `tone: positive | warning | neutral`) with a paired
  `-foreground`. Backs the Completed/Partial badge; Log's inline "Partial" text
  can adopt it later (out of scope here).
- **`src/components/ui/card.tsx`** (new primitive) — rounded
  `bg-background-element` surface with padding variants. Backs both the stat
  tiles and the segment card.
- **`src/components/stat-grid.tsx`** (new domain component) — `StatGrid` (2-col)
  + `StatGrid.Tile` compound (dot-notation per ADR 0013), composing `Card` +
  `Text`.
- **Reuse** `SegmentBar`, `SegmentLegend` unchanged.
- **`src/domain/run-stats.ts`** (new, pure TS) — `runStats(segments)` →
  `{ timeRunningS, runIntervals, longestRunS }`, covered by
  `run-stats.test.ts` (cases: completed, partial/ended-early, a skipped
  interval, single continuous-run week). Formatting reuses `formatClock`.
- **`src/domain/format.ts`** — add `formatRunDate(iso)` (weekday-short, month-short,
  day). Mirrors the existing `toLocaleDateString` use in Log; note locale
  dependence in its test.

## Known implementation gotchas

- **Island host sizing.** The bottom `Island.Button` needs an explicitly sized
  host — `matchContents` collapses a full-width button (prior finding). Size the
  host to the content width.
- **Safe-area insets.** Use safe-area-context insets for top/bottom if available
  in the project; otherwise keep an explicit inset. Verify on the simulator.
- **@expo/ui List row tap** — verify the SDK-57 API before wiring the Log rows
  (see navigation note above).

## Testing

- **Unit (`bun test`):** `run-stats.test.ts` and a `formatRunDate` case.
- **E2E (Maestro, ADR 0001/0016):** update the `session` flow's summary
  assertions to the new text-first anchors (celebratory line / session title /
  stat labels replace the old "Workout complete!" / grouped-list copy). Add a
  short `log`-tapped-run → summary → dismiss flow. Run the full suite before
  merge per policy.
- **Simulator (argent, per AGENTS.md):** this is a visible UI + navigation
  change, so verify on the iOS simulator — post-run finish path, Log-revisit
  path, Done from each, and the partial-run + save-failed states — before it's
  considered done.

## Future (out of scope)

Route map, GPS distance, and average pace (ADR 0010) — the header slot and the
stat grid are shaped to absorb them without further restructuring.
