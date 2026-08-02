# Run Elevation & Pace Profile — Design Spec

**Date:** 2026-08-02
**Status:** Approved pending final user review
**Scope:** A roadmap feature ([`docs/roadmap/README.md`](../../roadmap/README.md)), not a v1 delivery stage. This is the **GPS slice**; the barometer slice follows immediately after and is specified in [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md).
**Governing ADRs:** 0001 (E2E), 0003 (ports), 0004 (storage/reactivity), 0007 (engine event log), 0010 (the official-tooling exception precedent), 0013 (components), 0015 (elevation — deliberately unamended, §10), 0016 (Maestro selectors), 0021 (GPS smoothing)

## 1. Goal

*A finished run shows how it actually felt.* The run summary gains one card: a
two-line chart plotting **pace and elevation against distance**, with the run's
**total elevation gain and loss** in its header.

Elevation is captured for the chart and the totals only. It is **not** drawn on
the map (the route map stays as ADR 0010 left it) and **not** written to Apple
Health (§3.4 — the library cannot).

## 2. Decisions

| Topic | Decision |
|---|---|
| X axis | **Distance.** An elevation profile against time is an odd read for a runner; against distance it reads as terrain. |
| Gating | **GPS-recorded runs only.** A run without a usable route gets no card at all. Accepted deliberately: the alternative is a chart with one meaningful axis. |
| Elevation source | **Smoothed GPS altitude**, already persisted in `run_points.altitude` (§3.2). The barometer is the next slice and feeds the *same* reducer (§4.2), so it is a new source, not a second implementation. |
| Storage | **Stored rollup** — `elevation_gain_m` / `elevation_loss_m` on `runs`, written at finalize beside `distance_m`. **No backfill**: the app is pre-release, so runs recorded before this ships simply have `null`. This supersedes nothing — it *implements* [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md) item 5, which anticipated exactly these columns. |
| `elevation_source` column | **Deferred to the barometer slice.** Every value here is GPS, so the column would store a constant that nothing reads. The barometer slice needs its own migration for per-point barometric altitude and can add the discriminator there, when two sources actually exist. |
| Gain/loss placement | **Together, in the profile card's own header.** `RunStatGrid` is untouched — the totals belong beside the chart that explains them, not in the grid of headline numbers. |
| Live readout | **Summary only in this slice.** But the core helper is a *streaming reducer* (§4.2), so a live "currently climbing / descending" state on the run screen is later a read of state we already keep — not a rewrite. |
| Chart library | **`victory-native` (XL, v41).** Not an Expo-official package, so this needs the same explicit exception ADR 0010 made for react-native-maps — recorded in a new ADR (§10), not slipped in. |
| Apple Health elevation | **Not written.** `HKMetadataKeyElevationAscended` is the correct Apple mechanism and the library types it, but its bridge cannot produce an `HKQuantity` (§3.4). |
| ADR 0015 | **Left unamended** until the barometer slice, which will carry the device evidence its open item 7 demands (§10). |

## 3. Verified platform facts

Everything below was verified on 2026-08-02 against installed source and the
local SDK — not against documentation.

### 3.1 victory-native fits without a native change

`victory-native@41.26.0` peer requirements against what this repo already ships:

| Peer | Required | Installed | |
|---|---|---|---|
| `react-native-reanimated` | `>=3.0.0` | 4.5.1 | ✅ |
| `@shopify/react-native-skia` | `>=1.2.3 <3.0.0` | 2.6.2 | ✅ |
| `react-native-gesture-handler` | `>=2.0.0` | 2.32.0 | ✅ |

All three are already dependencies — Skia arrived with `skia-countdown.tsx`,
the other two with the run screen. victory-native's own runtime dependencies are
pure JS (`d3-scale`, `d3-shape`, `d3-zoom`, `its-fine`, `react-fast-compare`).

**Consequence that shapes the whole slice:** no native module means
`@expo/fingerprint` is unchanged, so `e2e-refresh` stays a ~1 min repack instead
of the 15–20 min rebuild that `expo-maps` and HealthKit each forced. This slice
is JS-only end to end apart from its migration.

Two API facts the design leans on:

- **Dual y-axis is first-class.** `CartesianChart` takes a `yAxis` *array*, each
  entry carrying its own `yKeys` and `axisSide` — which is what lets pace
  (sec/km) and elevation (m) share an x-axis without sharing a scale.
- **No font asset is needed.** Axis labels want an `SkFont`; the documented route
  bundles a `.ttf`, but `src/components/skia-countdown.tsx:33` already solves this
  with `matchFont({ fontSize, fontWeight })`. Nothing is added to `assets/`.

**Unverified, and gated (§9.1):** victory's docs state it is "built upon React
Native Reanimated (v3)". This repo runs Reanimated 4.5.1 with worklets extracted
into `react-native-worklets`. The peer range permits it and the repo's worklet
plumbing is proven, but *permitted by semver* is not *verified*.

### 3.2 The elevation data is already being recorded

`run_points.altitude` (`src/db/schema.ts`) is populated on every accepted fix:
`location-tracker/adapter.ios.ts:20` → `run-engine/engine.ts:447` → `run-store`.
So this slice needs **no new permission, no new sensor, and no change to the
capture path** — only a new fold over data the app already stores.

### 3.3 GPS altitude cannot be summed naively

ADR 0015's core finding stands: smartphone vertical error is ~2× horizontal
(~15–50 m), and summing per-sample deltas *systematically inflates* cumulative
gain. §5.3 is the mitigation, and §9.2's first test is the guard.

### 3.4 Apple Health cannot receive the elevation

The right mechanism exists and the library types it —
`WorkoutTypedMetadata.HKElevationAscended?: Quantity`
(`src/generated/healthkit.generated.ts:1071-1072`), schema
`"valueKind": "quantity"`. The bridge cannot carry it:
`saveWorkoutSample(..., metadata?: AnyMap)` → `anyMapToDictionary`
(`ios/Helpers.swift:428`) → `getAnyMapValue` (`ios/QuantityTypeModule.swift:263`),
which for an object-valued key returns `anyMap.getObject(key:)` — a raw nested
map, never an `HKQuantity`. HealthKit accepts only NSString / NSNumber / NSDate /
HKQuantity as metadata values.

This is a class, not one key: 23 of 71 metadata keys are quantity-valued, 12 of
them workout-applicable. Full evidence, and the deprecated-API root cause it
shares with the unwritable workout events, is in
[`docs/healthkit-capability-ledger.md`](../../healthkit-capability-ledger.md) §2.2 and §2.8.

**Caveat carried forward honestly:** that is a source read, not an observed
failure. It is listed in the ledger's §7 as needing a device test, and this spec
does not depend on it beyond declining to attempt the write.

## 4. Architecture

```
src/domain/elevation.ts             # PURE: streaming altitude reducer → gain/loss + trend
src/domain/run-profile.ts           # PURE: fixes → resampled chart series
src/hooks/use-run-profile.ts        # reads run_points ONCE, folds, memoizes
src/components/run-profile-card.tsx   # gating, header totals, a11y label (ADR 0013 domain component)
src/components/run-profile-chart.tsx  # the ONLY file importing victory-native
src/db/save-run.ts                  # (edit) elevation joins the finalize rollup
src/db/schema.ts                    # (edit) two columns + generated migration
```

### 4.1 Why the card and the chart are separate files

The card owns the decision (render, degrade, or nothing) and everything
accessible; the chart owns pixels. The split exists so `victory-native` is
imported in **exactly one file** — the containment discipline `expo-maps` gets in
`route-map/adapter.ios.tsx` (ADR 0010) and HealthKit gets in `adapter.ios.ts`
(ADR 0011). If §9.1's spike fails, one file changes.

**Not a component port.** `RouteMap` is a port because expo-maps is iOS-only
native code (ADR 0003). victory-native is pure JS and cross-platform, so a port
would be ceremony with nothing behind it. Recorded here so the asymmetry reads as
a decision rather than an oversight.

### 4.2 The elevation reducer — streaming, source-agnostic

```ts
export interface AltitudeSample { timestamp: number; altitudeM: number | null }
export type ElevationTrend = 'climbing' | 'descending' | 'flat';

export function createElevationState(): ElevationState;
export function elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep;
export function elevationRollup(samples: readonly AltitudeSample[]): ElevationRollup;
```

`elevationStep` / `elevationRollup` mirror `smoothFix` / `smoothTrack`
(ADR 0021 §2–§3) one-to-one: a per-sample reducer, plus a batch fold built *from*
that reducer so a live figure and a re-derived one cannot diverge.

Three properties are load-bearing for what comes next, and all three are free
today:

1. **The input is `{ timestamp, altitudeM }`, not a GPS fix.** The barometer
   feeds the identical reducer. That is what makes the next slice a new source
   rather than a second implementation.
2. **`trend` costs nothing.** The hysteresis accumulator (§5.3) works by holding a
   *pending monotonic move* until it clears a threshold — so the state already
   knows the direction and magnitude of the move in progress. "Am I climbing?" is
   a read of state the noise filter has to keep anyway.
3. **`ElevationState` is plain JSON** — numbers only, no `Map`s, no classes — so
   the engine can carry it in the crash-recovery snapshot (ADR 0007) when the
   live readout arrives, without reshaping it.

### 4.3 The hook

`useRunProfile(runId, loaded)` is modelled directly on `useRunRoute`
(`src/hooks/use-run-route.ts`): the same `loadRunFixes` read — **once,
non-reactively, never `useLiveQuery` on `run_points`** (ADR 0004 §3) — the same
`useMemo` keying that survives rotation and theme changes, and the same
`try/catch` that degrades to no card rather than crashing an unbounded route.

## 5. The data pipeline

The same persisted fixes are folded at two different moments, and it matters
which is which:

**At finalize, once, written to `runs` (§6):** steps 1–3, then gain/loss by
hysteresis accumulation (§5.3) via `elevationRollup`.

**At display, on every summary open, never written:** steps 1–5, producing the
chart series. The totals shown in the card header are *read from the stored
columns* — they are not recomputed here.

Both paths fold the identical `run_points` stream through the identical reducer,
which is what makes the stored total and the drawn profile agree by construction
rather than by coincidence (the same guarantee ADR 0021 §3 gives distance).

1. `loadRunFixes(runId)` → fixes in `seq` order.
2. Fold with **the same `smoothFix` primitives the distance used** (ADR 0021 §3)
   to obtain per-fix cumulative distance. This is what guarantees the chart's
   x-axis extent equals the summary's headline distance.
3. Smooth altitude with a median window (`ALTITUDE_MEDIAN_WINDOW`, seeded at 5 —
   the precedent `MEDIAN_WINDOW_SIZE` sets for the horizontal signal, `geo.ts:116`),
   then **rebase so the start reads 0**.
4. Resample onto a uniform distance grid (`PROFILE_SAMPLE_COUNT`, seeded at 120).
5. Pace per **bucket** = bucket duration ÷ bucket distance.

### 5.1 Why rebase to zero

ADR 0015 item 1 decided the app captures **relative** elevation, never absolute.
Plotting raw GPS altitude would put a number on the axis that can be 50 m wrong.
The profile's *shape* is the honest signal; its offset is not.

### 5.2 Why pace is bucketed, never instantaneous

Per-fix pace from GPS is unreadable noise. Bucketing by distance is what makes
the line legible — and it falls out for free, since step 4 is resampling anyway.

### 5.3 Hysteresis is the whole game

A move is only banked as gain or loss once it clears `ELEVATION_HYSTERESIS_M`
monotonically; below that it stays pending and can be cancelled by a reversal. So
sample-to-sample jitter cancels instead of accumulating. Without this, a flat
5 km reports well over a hundred metres of climb.

The threshold is seeded at **3.0 m** and is explicitly **tunable against real
recorded runs**. §9.2's tests assert the *property* (noisy flat ground → ~0 gain;
a clean monotonic climb → exactly its height), never a magic constant, so tuning
the value does not rewrite the suite.

### 5.4 The pace axis must read fast-at-top

Lower sec/km is faster, so a naively plotted pace line reads upside-down. Whether
this is expressed as a reversed axis `domain` tuple or by plotting negated values
with formatted ticks is settled in the §9.1 spike rather than guessed here.

## 6. Storage and the finalize rollup

Two nullable columns on `runs`: `elevation_gain_m`, `elevation_loss_m` (REAL).
Additive, no change to existing rows (ADR 0004).

The migration is produced by `bun run db:generate` and committed as generated —
`src/db/migrations/` is hook-guarded and must never be hand-edited.

The rollup site already exists. `rollupFromPoints` (`src/db/save-run.ts:12`)
re-folds the persisted fixes at finalize; elevation joins that fold, and the two
values join the single `set()` inside the existing transaction
(`src/db/save-run.ts:102-118`) beside `distanceM` and `summaryPolyline`.

**One asymmetry carried over deliberately.** `saveRun` — the path with no
`'active'` row and therefore no `run_points` to re-derive from — writes
`distanceM: record.distanceM ?? null`. Elevation is `null` there for the same
reason: no points, no elevation. The existing `// why:` comment at
`src/db/save-run.ts:29` already explains the class.

## 7. UI surfaces

### 7.1 `RunProfileCard`

A `Card` (ADR 0013) placed in `src/app/runs/[runId]/index.tsx` **between
`RunStatGrid` and `SegmentBreakdown`** — headline numbers, then the profile that
explains them, then the interval breakdown.

Its header carries both totals together, `arrow.up.right` / `arrow.down.right`
SF Symbols with metre values rounded to 5 m (§11.2). The chart sits below.

**Accessibility is the card's job, not the chart's.** A Skia canvas is invisible
to VoiceOver, so the chart is marked `accessibilityElementsHidden` and the card
carries a summarising label — the same discipline `RouteMapCard` uses for its
inert map (`route-map-card.tsx`), e.g. *"Elevation and pace profile: 124 metres
gained, 118 metres lost over 5.2 kilometres."*

### 7.2 `RunProfileChart`

`CartesianChart` with `xKey="distanceM"`,
`yKeys={['paceSecPerKm', 'elevationM']}`, and a two-entry `yAxis` array splitting
pace to the left and elevation to the right. Colours come from `useTheme()`:
pace reuses the existing `stat.pace` tint, elevation adds one new token pair
(`src/global.css` + its `src/constants/theme.ts` mirror — both, per ADR 0002).

## 8. Failure and degradation

Reuses the `RouteUnavailableCard` discipline: never render nothing without a
reason, never render a misleading chart.

| Situation | Behaviour |
|---|---|
| No fixes, or route below `MIN_ROUTE_EXTENT_M` | **No card at all.** The route card directly above already explains why this run has no GPS data; a second explanatory card is noise. |
| Usable distance, every altitude `null` | Chart renders **pace only** — right axis and elevation line omitted, header totals omitted. |
| Altitude present but degenerate (all equal) | Flat elevation line, gain/loss `0 m`. Honest, not hidden. |
| `loadRunFixes` throws | `console.warn` and no card, exactly as `use-run-route.ts` catches today. |
| Run finalized before this shipped | `elevation_gain_m` is `null`; header totals omitted, chart still renders from points. |

## 9. Testing

### 9.1 The spike is a hard gate

**Before any other file is written**, render a minimal two-line `CartesianChart`
in the dev client and confirm it mounts, paints and survives a re-render under
Reanimated 4.5.1 / worklets 0.10.1. Verified on the simulator via argent.

If it fails, the fallback is a plain Skia `Path` — which this repo already draws
in `skia-countdown.tsx` — and only `run-profile-chart.tsx` changes. The spike
also settles §5.4's axis-inversion mechanism.

### 9.2 Unit (`bun test`) — where the risk actually lives

`domain/elevation.ts` and `domain/run-profile.ts` are pure, so they carry the
coverage:

- **Noisy flat ground → ~0 gain.** The ADR 0015 inflation guard, and the single
  most important test in this slice.
- Clean monotonic climb → exactly its height; a climb-then-descend → matching
  gain and loss.
- A pending move below threshold that reverses → banks nothing.
- `null` altitudes: interspersed, all-null, and leading/trailing.
- Single-fix and empty runs.
- `elevationRollup` equals a manual fold of `elevationStep` over the same samples
  — the live-vs-re-derived guarantee (ADR 0021 §3's property, applied here).
- Resampling preserves total distance, and bucket count is stable for short and
  long runs alike.

### 9.3 E2E can only assert the absence path

**Maestro cannot produce GPS motion** (ADR 0001's 2026-07-31 amendment), so the
suite contains no run with a route at all — `complete-session.yaml:22` currently
asserts `"No route for this run"`. The only honest flow assertion is therefore
that the profile card **does not** render for a motionless run, added to that
same flow.

No flow can prove the chart is correct. Recorded as a limitation, not papered
over.

### 9.4 Manual verification

Drive the simulator's own route engine, which AGENTS.md documents as working
where Maestro's `travel` does not:

```
xcrun simctl location <udid> start --speed=2.8 --interval=1.0 59.3293,18.0686 59.3353,18.0686
```

Then confirm on the summary: the card appears, both lines render, the pace line
reads fast-at-top, the totals are plausible for the simulated route, and
VoiceOver reads the card's summary label. Repeat once in dark mode
(`xcrun simctl ui <udid> appearance dark`) and once at an accessibility text size.

## 10. Documentation impact

- **New ADR (0024)** — adopting `victory-native`: the official-tooling exception
  (AGENTS.md prefers Expo-official packages; ADR 0010 set the precedent for
  making such an exception explicitly), the single-import containment rule, and
  the Reanimated 4 risk with its Skia fallback.
- **ADR 0015 — deliberately untouched.** Its open item 7 (does the barometer
  deliver while backgrounded?) can only be closed with device evidence, and this
  slice generates none. The barometer slice amends it, and will also record that
  item 5's columns landed here.
- **`docs/roadmap/README.md`** — move "Run elevation on the map" to `Planned`,
  and correct its title: elevation is **not** going on the map.
- **`docs/healthkit-capability-ledger.md`** — already written; this spec is the
  first consumer of its §2.2.
- **Stage 5 spec** (`2026-07-31-stage-5-apple-health-design.md`) — add the
  quantity-metadata blocker as a fifth entry to §3.1's "four limitations", and
  fix the share-description citation from `app.plugin.ts:44-47` to `:44-50`.
- **AGENTS.md** — add `domain/elevation.ts` and the chart to the Architecture
  section's current-state paragraph once built.

## 11. Risks

1. **victory-native under Reanimated 4.** Gated by §9.1 before any other work;
   fallback is a Skia `Path` in one file. This is the only risk that could change
   the shape of the slice.
2. **GPS gain/loss is approximate.** Values are rounded to 5 m and must never be
   presented as precise. A runner will compare them against Strava and find them
   different; the barometer slice is the answer, and it is next.
3. **A non-Expo-official dependency enters the tree.** Priced by ADR 0024. Pure
   JS, one import site, and a proven fallback keep the blast radius small.
4. **Hysteresis tuning is empirical.** The seeded 3.0 m is a starting point, not
   a verified constant; §9.2 tests properties so tuning is cheap.

## 12. Out of scope

Elevation on the route map · absolute elevation and any network/DEM source
(ADR 0015 item 6) · barometer capture (the next slice) · a live
climbing/descending readout on the run screen (designed for in §4.2, not built) ·
writing elevation to Apple Health (§3.4) · elevation in the Log list or any
aggregate/all-time elevation stat · chart interaction — no tooltips, pan, zoom or
scrubbing in this slice · Android.
