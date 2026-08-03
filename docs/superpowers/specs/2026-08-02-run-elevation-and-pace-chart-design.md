# Run Elevation & Pace Profile — Design Spec

**Date:** 2026-08-02
**Status:** Approved. **Amended twice on 2026-08-03 during implementation.** First
the elevation totals and their storage were cut on measured evidence (§3.5); then a
review found that reasoning inverted and **elevation was deferred whole** (§3.6).
This slice ships a pace-only chart. Everything else stands.
**Scope:** A roadmap feature ([`docs/roadmap/README.md`](../../roadmap/README.md)), not a v1 delivery stage. This is the **GPS slice**; the barometer slice follows immediately after and is specified in [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md).
**Governing ADRs:** 0001 (E2E), 0003 (ports), 0004 (storage/reactivity), 0007 (engine event log), 0010 (the official-tooling exception precedent), 0013 (components), 0015 (elevation — deliberately unamended, §10), 0016 (Maestro selectors), 0021 (GPS smoothing)

## 1. Goal

*A finished run shows how it actually felt.* The run summary gains one card
plotting **pace against distance**.

**Amended 2026-08-03: elevation is deferred whole** (§3.6). Two rounds of
measurement showed GPS altitude can support neither the totals nor the line
honestly, so both wait for the barometer slice rather than shipping a chart that
draws terrain where there is none. The elevation *machinery* — `domain/elevation.ts`
and its tests — is built and kept here, because the barometer slice consumes it
unchanged and because its tests encode findings that would be expensive to
rediscover (§4.3).

Elevation is also **not** drawn on the map (the route map stays as ADR 0010 left
it) and **not** written to Apple Health (§3.4 — the library cannot).

## 2. Decisions

| Topic | Decision |
|---|---|
| X axis | **Distance.** Originally chosen because an elevation profile reads as terrain against distance. With elevation deferred (§3.6) that rationale no longer applies to what ships, and a reviewer noted pace is arguably time-structured for this app — on W1D1 the 8 running minutes take 39% of the chart width. **Kept as the owner's standing decision**, and revisited when elevation lands. |
| Gating | **GPS-recorded runs only.** A run without a usable route gets no card at all. Accepted deliberately: the alternative is a chart with one meaningful axis. |
| Elevation source *(when it ships)* | **Barometer**, via the same reducer (§4.2). GPS altitude is retained in `run_points` and remains a fallback the reducer can consume, but it is no longer the source anything displays. |
| Elevation, **entirely** | **Not shipped in this slice — amended twice, see §3.5 and §3.6.** The design first stored and displayed gain/loss totals; measurement cut those (§3.5). A second review then found §3.5's reasoning inverted — hysteresis protects the totals, not the line, so the line fabricates ~11 m of terrain on flat ground at ±10 m noise (§3.6). **Owner's decision 2026-08-03: defer elevation whole.** This slice ships a **pace-only chart**; the elevation line and its totals arrive together with the barometer, on a source that can carry both honestly. |
| Storage | **None.** No schema change, no migration. [ADR 0015](../../adr/0015-run-elevation-on-device-barometer.md) item 5's `elevation_gain_m` / `elevation_loss_m` columns land with the barometer slice that can populate them honestly. |
| Reducer tuning | **A parameter, not a constant** (§4.2). The right smoothing window and hysteresis threshold depend on the *source*: GPS needs an aggressive window against ±10–25 m noise, a barometer at ~1 m precision needs a gentle one. A single module constant would be wrong for one of them. |
| Card contents | **One pace line.** `RunStatGrid` is untouched; the card header carries only its title. |
| Live readout | **Summary only in this slice.** But the core helper is a *streaming reducer* (§4.2), so a live "currently climbing / descending" state on the run screen is later a read of state we already keep — not a rewrite. |
| Chart library | **`victory-native` (XL, v41).** Not an Expo-official package, so this needs the same explicit exception ADR 0010 made for react-native-maps — recorded in a new ADR (§10), not slipped in. |
| Apple Health elevation | **Not written.** `HKMetadataKeyElevationAscended` is the correct Apple mechanism and the library types it, but its bridge cannot produce an `HKQuantity` (§3.4). |
| ADR 0015 | **Amended with this slice's measurements** (§10) — the quantified GPS noise findings belong in the ADR that decided barometer-first. Its open item 7 stays open; only the barometer slice can close it with device evidence. |

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
is JS-only end to end (and, after the 2026-08-03 amendment, has no migration
either — §6).

Two API facts the design leans on:

- **Dual y-axis is first-class.** `CartesianChart` takes a `yAxis` *array*, each
  entry carrying its own `yKeys` and `axisSide` — which is what will let pace
  (sec/km) and elevation (m) share an x-axis without sharing a scale. Verified in
  Task 1's spike and recorded for the barometer slice; **this slice draws one
  line and one axis** (§3.6).
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

### 3.5 Measured 2026-08-03: GPS totals are not trustworthy enough to display

The original design assumed hysteresis would make GPS totals merely
*approximate*. It was measured during implementation rather than assumed, over
5 seeds × 1800 samples (30 min at 1 Hz), and the assumption was wrong.

| Vertical noise | Window / hysteresis | Phantom gain on flat ground | Real 40 m climb (gain/loss) |
|---|---|---|---|
| ±10 m | 8 / 3 | **537 m** | 167 / 163 |
| ±10 m | 31 / 10 | **0 m** | 41.5 / 31.5 |
| ±25 m | 31 / 10 | **85 m** | 83.7 / 69.3 |
| ±25 m | 61 / 30 | 0 m | 30.7 / **0.0** |

Two things follow. In open sky (±10 m) a window of 31 with a 10 m threshold is
genuinely good: zero phantom gain, and 41.5 m reported for a real 40 m climb. In
poor conditions (±25 m) the same settings report **85 m of climb on flat
ground**, and the settings aggressive enough to suppress that (61/30) also report
**zero loss on a run that descended 40 m** — the filter that rejects bad-condition
noise erases real terrain.

There is no setting safe in both regimes, because **the reducer cannot know which
regime it is in**. A displayed total would therefore be right in good conditions
and about 2× wrong in poor ones, which is worse than approximate.

### 3.6 Correction, 2026-08-03: §3.5 protected the wrong output

§3.5 originally concluded *"the elevation line is unaffected — shape survives
smoothing; only the integral is untrustworthy."* **That is inverted, and the
error is worth recording rather than quietly deleting.**

The hysteresis threshold — the whole noise-rejection mechanism — applies **only**
to `gainM`/`lossM`. `seriesM` receives the median smoothing and **no threshold at
all**. So the totals are the *protected* output and the line is the *unprotected*
one. Deferring the totals while shipping the line cut the safe number and kept the
unsafe drawing.

Measured (30 seeds, 1800 samples, y-axis auto-fits so the span *is* the full chart
height):

| Ground truth | Span the line draws | Banked gain |
|---|---|---|
| Flat, ±5 m noise | 5.4 m (worst 7.7) | 0.0 m |
| Flat, ±10 m noise | **10.8 m** (worst 15.3) | 2.5 m |
| Flat, ±25 m noise | **27.1 m** (worst 38.4) | 97.1 m |
| A real 8 m hill | 7.8 m | — |
| A real 20 m hill | 19.5 m | — |

A flat park loop at ±10 m noise therefore draws a rolling landscape of the same
order as a real 20 m hill, at full chart height — while the number that would have
correctly said "2.5 m, flat" was removed as dishonest. At ±25 m the fabricated
terrain is *larger* than a real 20 m hill.

**How the error survived scrutiny:** every measurement behind §3.5 was taken of
`gainM`. `seriesM` was never plotted. A claim about the line's trustworthiness was
inferred from data about the totals, and reviewers checking code-against-spec had
no reason to doubt the spec itself.

**Consequence — elevation is deferred whole (owner's decision, 2026-08-03).** This
slice ships a **pace-only chart**. Elevation — line and totals together — lands
with the barometer slice, on a ~1 m-precision source where both are honest. Two
findings that survive and are *not* the reason for deferring, both measured:

- **Real terrain is not erased by the smoothing.** An 8 m footbridge over 60 m
  plots at 66% amplitude noise-free and 94% with noise; a 20 m hill at 90–97%; a
  40 m hill at 97–101%. Median filters preserve edges. The problem was fabrication
  on flat ground, never erasure of real ground.
- **Distance-bucketing preserves C25K intervals.** A synthesised W1D1 crossed the
  run/walk pace midpoint 16 times against 16 real transitions, retaining 94% of the
  true contrast. The bucketing design is sound.

This remains a direct vindication of ADR 0015's barometer-first decision. What it
strained — twice now — is this spec's original *ordering*, not that ADR.

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
src/components/run-profile-card.tsx   # gating, a11y label (ADR 0013 domain component)
src/components/run-profile-chart.tsx  # the ONLY file importing victory-native
```

No `src/db/` change: this slice stores nothing (§6).

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

/** Tuning travels with the state, because the right values depend on the source (§3.5). */
export interface ElevationConfig { medianWindow: number; hysteresisM: number }
export const GPS_ELEVATION_CONFIG: ElevationConfig;

export function createElevationState(config?: ElevationConfig): ElevationState;
export function elevationStep(state: ElevationState, sample: AltitudeSample): ElevationStep;
export function elevationRollup(
  samples: readonly AltitudeSample[],
  config?: ElevationConfig,
): ElevationRollup;
```

**Tuning is a parameter, not a module constant** (amended 2026-08-03). §3.5
measured that GPS needs a wide window and a ~10 m threshold to reject its noise,
while a barometer at ~1 m precision would have real terrain erased by those same
values. Baking one pair into the module would silently mis-tune whichever source
came second. The config rides on `ElevationState`, so it stays plain JSON and the
barometer slice adds a second preset rather than retuning a shared constant.

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
   it can be serialised without reshaping if it ever needs to be.
   **Corrected 2026-08-03:** this originally said the engine would carry it in the
   crash-recovery snapshot. That contradicts the established design — ADR 0007 §5
   keeps the snapshot to the event log plus watermarks and anchors, never derived
   filter state, and ADR 0021 §3 re-derives smoothed values from the persisted
   fixes precisely so live and replayed results cannot diverge. Elevation follows
   the same rule: re-derive from `run_points`, do not snapshot. Plain JSON remains
   worth keeping as a cheap constraint, not as a snapshot plan.

### 4.3 Why `domain/elevation.ts` stays despite shipping unconsumed

Choice C (§3.6) leaves the elevation reducer with no production caller in this
slice. It is kept anyway, and that is a deliberate exception to YAGNI:

- The **barometer slice consumes it unchanged** — it is the source-agnostic seam
  §4.2 exists to provide, and it lands next, not eventually.
- Its **tests encode measured findings** — the warm-up defect, the ±25 m limit,
  the per-source config argument — that cost real effort to establish and would be
  silently rediscovered if the module were deleted and rebuilt.
- It is the seam for the **live climbing/descending readout** the owner asked the
  design to leave room for.

It must therefore be *correct*, not merely present: the warm-up defect (§9.2) is
fixed here rather than deferred with its consumer.

### 4.4 The hook

`useRunProfile(runId, loaded)` is modelled directly on `useRunRoute`
(`src/hooks/use-run-route.ts`): the same `loadRunFixes` read — **once,
non-reactively, never `useLiveQuery` on `run_points`** (ADR 0004 §3) — the same
`useMemo` keying that survives rotation and theme changes, and the same
`try/catch` that degrades to no card rather than crashing an unbounded route.

## 5. The data pipeline

One fold, at display time, on every summary open. Nothing is written (§6).

1. `loadRunFixes(runId)` → fixes in `seq` order.
2. Fold with **the same `smoothFix` primitives the distance used** (ADR 0021 §3)
   to obtain per-fix cumulative distance. This is what guarantees the chart's
   x-axis extent equals the summary's headline distance.
3. Resample onto a uniform distance grid (`PROFILE_SAMPLE_COUNT`, seeded at 120).
4. Pace per **bucket** = bucket duration ÷ bucket distance, with the bucket's clock
   starting at the **previous** fix's timestamp (§5.2).

No altitude step: elevation is deferred whole (§3.6).

### 5.1 Why rebase to zero

ADR 0015 item 1 decided the app captures **relative** elevation, never absolute.
Plotting raw GPS altitude would put a number on the axis that can be 50 m wrong.
The profile's *shape* is the honest signal; its offset is not.

### 5.2 Why pace is bucketed, and the boundary rule that makes it correct

Per-fix pace from GPS is unreadable noise. Bucketing by distance is what makes the
line legible — and it falls out for free, since the resampling happens anyway.

**The boundary rule is load-bearing and was got wrong once.** A bucket's metres
necessarily include the leg *entering* it — the distance travelled between the
previous bucket's last fix and this bucket's first. Its clock must therefore start
at that **previous fix's timestamp**, not at the first fix inside the bucket.
Measuring time only *within* the bucket while counting distance *into* it makes
distance span N legs and time span N−1, so pace reads fast by exactly 1/N.

Measured on a dead-steady 3 m/s synthetic run (true 333.3 s/km): at 120 buckets
(5 fixes each) the naive version reports **267 s/km, 19.7% fast**; the bias
worsens as runs shorten — −3.9% at 50 min, −19.7% at 10 min, **−41.3% at 5 min**.
C25K runs live at the short end, and the chart would have disagreed with the
summary's own headline pace on the same screen.

The alternative — dropping each bucket's entry leg from its metres — is wrong: it
breaks distance conservation, so the buckets would no longer sum to the run.

### 5.3 Hysteresis, and why it is kept despite the totals not shipping

A move is only banked as gain or loss once it clears `config.hysteresisM`
monotonically; below that it stays pending and can be cancelled by a reversal.

Nothing in this slice *displays* gain or loss (§2). The machinery is still built
and still tested, for two reasons: the barometer slice lands next and needs it on
data that can support it, and the sticky `trend` that answers "am I climbing right
now?" is a read of the hysteresis state (§4.2 property 2) — the explicit
forward-looking requirement this design was asked to leave room for.

§9.2's tests assert *properties* (realistic noise → ~0 gain; a clean monotonic
climb → close to its height), never a magic constant, so re-tuning a config
preset never rewrites the suite.

### 5.4 The pace axis must read fast-at-top

Lower sec/km is faster, so a naively plotted pace line reads upside-down. Whether
this is expressed as a reversed axis `domain` tuple or by plotting negated values
with formatted ticks is settled in the §9.1 spike rather than guessed here.

## 6. Storage — none *(amended 2026-08-03)*

**This slice adds no column, no migration, and no change to `src/db/`.**

The original design stored `elevation_gain_m` / `elevation_loss_m` on `runs` at
finalize. §3.5 removed the reason to: the only consumer was the card header, and
that header is not shipping. Storing a figure nothing displays would mean
committing a migration for data measured to be ~2× wrong in poor conditions, then
having to decide at the barometer slice whether to trust, recompute, or discard
every stored GPS value.

The chart re-derives its series from `run_points` on each open, which is cheap at
C25K volumes (~1800 rows) and is exactly what `useRunRoute` already does for the
route map.

ADR 0015 item 5's columns are not cancelled — they land with the barometer slice,
which can populate them from a ~1 m-precision source and needs its own migration
for per-point barometric altitude regardless. That slice adds the
`elevation_source` discriminator at the same time, when two sources finally exist
to distinguish.

## 7. UI surfaces

### 7.1 `RunProfileCard`

A `Card` (ADR 0013) placed in `src/app/runs/[runId]/index.tsx` **between
`RunStatGrid` and `SegmentBreakdown`** — headline numbers, then the profile that
explains them, then the interval breakdown.

Its header carries the card title only. **No gain/loss totals** — §2 and §3.5.

**Accessibility is the card's job, not the chart's.** A Skia canvas is invisible
to VoiceOver, so the chart is marked `accessibilityElementsHidden` and the card
carries a summarising label — the same discipline `RouteMapCard` uses for its
inert map (`route-map-card.tsx`), e.g. *"Elevation and pace profile: 124 metres
gained, 118 metres lost over 5.2 kilometres."*

### 7.2 `RunProfileChart`

`CartesianChart` with `xKey="distanceM"`, `yKeys={['paceSecPerKm']}`, and a
single left `yAxis` whose domain is reversed so faster reads higher (§5.4). The
colour is the existing `stat.pace` tint from `useStatColors()`.

No elevation line and no right axis in this slice (§3.6). The dual-axis mechanism
is verified and documented (§3.1) for the barometer slice to use unchanged.

## 8. Failure and degradation

Reuses the `RouteUnavailableCard` discipline: never render nothing without a
reason, never render a misleading chart.

| Situation | Behaviour |
|---|---|
| No fixes, or route below `MIN_ROUTE_EXTENT_M` | **No card at all.** The route card directly above already explains why this run has no GPS data; a second explanatory card is noise. |
| Fewer than two usable buckets | No card — a single point draws no line and is indistinguishable from no chart. |
| A bucket with one fix, or zero elapsed time | That bucket's `paceSecPerKm` is `null`; the line breaks rather than plotting a fabricated value. |
| `loadRunFixes` throws | `console.warn` and no card, exactly as `use-run-route.ts` catches today. |
| Run finalized before this shipped | No special case — the series is re-derived from `run_points`, which every GPS-recorded run already has. |

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

- **Warm-up: the anchor must not be seeded from an unsmoothed reading.** Measured
  defect — anchoring on the first raw sample banks phantom gain equal to a bad
  first fix's magnitude (`[130, ...flat]` → 30 m of loss on flat ground) and
  rebases the whole series on it, drawing a flat run as a 30 m descent. GPS
  altitude is worst at fix acquisition, exactly where this reads. Over 200 seeds
  of the ±10 m fixture: mean phantom gain 3.56 m, worst 22.38 m; deferring the
  anchor until the window fills gives 0.00/0.00. **100% of the ±10 m phantom gain
  was warm-up.** Test across ≥50 seeds, never 5 — the committed 5-seed test passed
  on seed luck, all five returning exactly 0.00.
- **Realistic noise on flat ground → ~0 gain.** The ADR 0015 inflation guard. **The fixture must be genuine
  pseudo-random noise (a seeded PRNG), never a sinusoid** — §3.5 found that a
  coherent sinusoid is annihilated by a median filter, so a sinusoidal fixture
  passes while the reducer banks hundreds of phantom metres against real noise.
  A second case at ±25 m documents the degradation §3.5 measured rather than
  pretending it away.
- Clean monotonic climb → close to its height; a climb-then-descend → gain and
  loss within a metre of each other. **Both fixtures must be padded with flat
  samples at each end**: the trailing median warms up at the start but lags at
  the end, and an unpadded fixture bakes that 4.5 m boundary artifact into the
  assertion (§3.5).
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
reads fast-at-top, its values agree with the summary's own headline pace stat
(§5.2 — they disagreed by 20% before the boundary rule was fixed), and VoiceOver
reads the card's summary label. Repeat once in dark mode
(`xcrun simctl ui <udid> appearance dark`) and once at an accessibility text size.

## 10. Documentation impact

- **New ADR (0024)** — adopting `victory-native`: the official-tooling exception
  (AGENTS.md prefers Expo-official packages; ADR 0010 set the precedent for
  making such an exception explicitly), the single-import containment rule, and
  the Reanimated 4 risk with its Skia fallback.
- **ADR 0015 — amend with §3.5's measurement.** The ADR asserted GPS altitude is
  too noisy to sum; this slice *quantified* it (537 m phantom gain at ±10 m
  untuned; ~2× error at ±25 m even tuned) and found no setting safe across both
  regimes. That is new evidence strengthening a decision the ADR already made, and
  it belongs in the ADR rather than only in a spec. Item 7 (does the barometer
  deliver while backgrounded?) still awaits device evidence this slice cannot
  produce; item 5's columns now land with the barometer slice, not here.
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
2. **Retired 2026-08-03 by deferring elevation whole.** This risk read "GPS
   gain/loss is approximate, round to 5 m". §3.5 measured it as ~2× wrong; §3.6
   then found the *line* was the unprotected output and fabricated ~11 m of terrain
   on flat ground. Neither output ships (§2), so the risk is gone rather than
   mitigated. It returns, on better data, with the barometer slice.
3. **A non-Expo-official dependency enters the tree.** Priced by ADR 0024. Pure
   JS, one import site, and a proven fallback keep the blast radius small.
4. **Hysteresis tuning is empirical.** The seeded 3.0 m is a starting point, not
   a verified constant; §9.2 tests properties so tuning is cheap.

## 12. Out of scope

**Elevation entirely — the chart line, the gain/loss totals, and the columns that
would store them (§3.6 — deferred to the barometer slice, not cancelled)** ·
elevation on the route map · absolute elevation and any network/DEM source (ADR 0015 item 6) · barometer
capture (the next slice) · a live climbing/descending readout on the run screen
(designed for in §4.2, not built) · writing elevation to Apple Health (§3.4) ·
elevation in the Log list or any aggregate/all-time elevation stat · chart
interaction — no tooltips, pan, zoom or scrubbing in this slice · Android.
