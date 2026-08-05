# Pace chart: standstill time is not pace time — design

Date: 2026-08-05
Status: **design — awaiting approval**

Refines the pace chart shipped in the
[run elevation & pace chart slice](2026-08-02-run-elevation-and-pace-chart-design.md).
That slice's §5.2 fixed one shape of this defect — a bare timestamp gap — and
explicitly decided the other shape was correct behaviour. Four field captures
say otherwise. §13 records what this reverses and why.

Every number below is measured against four real runs, exported by the
[field-test capture protocol](../../field-test-capture-protocol.md):

| capture | session | distance | active | fixes |
| --- | --- | --- | --- | --- |
| `runbro-20260731-1421-3ff243b0` | w3d3 | 2765 m | 1415 s | 1414 |
| `runbro-20260731-1542-38f9634f` | w3d1 | 2966 m | 1628 s | 1532 |
| `runbro-20260803-1722-98459df2` | w3d1 | 2934 m | 1460 s | 1460 |
| `runbro-20260803-1753-b4ae7b11` | w3d2 | 3108 m | 1473 s | 1463 |

---

## 1. What this slice is

**It is:** three changes to how the pace series is folded, and one annotation
layer on the chart.

1. A standstill at the run's start or end leaves the chart entirely.
2. A standstill mid-run keeps its metres and loses its seconds.
3. A stop of 5 s or more is drawn as a dashed vertical rule at its distance.

**It is not:** any change to recorded distance, to the summary's headline figures,
to the route map, or to what is stored. Nothing new is persisted and no
dependency is added, so the native fingerprint is untouched and the next release
stays OTA-eligible (ADR 0012).

## 2. The defect

The chart buckets by **distance** and each bucket's pace is `seconds / metres`
(§5.2 of the pace chart design). That is the right series for a pace-vs-distance
chart, and it makes a stationary runner a **pole**: seconds accrue while metres
do not, so the bucket's pace grows without bound.

Measured with the shipped `toRunProfile`, worst bucket against the run's median:

Head and tail standstill below are as §5's detector measures them, so the same
basis as §6's trim table:

| capture | standing head | standing tail | worst bucket | vs median |
| --- | --- | --- | --- | --- |
| `3ff243b0` | 6 s | — | #112 = 16:19 | 1.8× |
| `38f9634f` | 47 s | 173 s | #119 = **125:36** | **15.9×** |
| `98459df2` | 5 s | 12 s | #119 = 18:56 | 2.2× |
| `b4ae7b11` | 17 s | — | #0 = 16:32 | 2.0× |

The y axis auto-fits to the extreme, so the run's genuine signal is squeezed into
whatever is left. Taking **the share of plot height occupied by the min–p95 pace
band** as the readability metric — the same quantity §5.2's gap tests already
assert as `bandContrast` — `38f9634f` gives the real run/walk separation **4%**
of the chart. One bucket, 25 m of ground and 186 s of standing about after
finishing, owns the other 96%:

```
BEFORE   axis 5:11 (top) … 125:36 (bottom)
  5:11 |***********************************************************
       |*
       |
       |
 65:24 |
       |
       |
       |
125:36 |
```

**`3ff243b0` is not a counter-example, and this was got wrong once during
brainstorming.** Its ends are effectively clean — the 6 s head costs it 4 m and
changes its axis by 2 s — so it was first read as a control case whose 16:19
bucket was a genuinely slow walk. It is not: bucket #112 is a **6-second stop at
2.60 km**. The run's own numbers make the
sensitivity plain — 6 s of standing inside a 23.0 m bucket moves it from ~9:00 to
16:19 /km. A distance bucket is roughly 20× more sensitive to standstill seconds
than to running seconds, because the divisor stops growing while the dividend
does not.

## 3. Why the shipped guard misses it

§5.2 excludes any leg longer than `MAX_GAP_S` (30 s), which is correct for a
pause or a tunnel: the fixes are *absent*, and such a leg committed no distance
to lose. It assumed a standstill would look the same. **It does not, because iOS
keeps delivering fixes while the phone stands still.**

Inter-fix interval, split by whether the runner was moving:

| capture | stationary | moving | legs > `MAX_GAP_S` |
| --- | --- | --- | --- |
| `3ff243b0` | n=11, med 1.0 s, max 1.5 s | n=1402, med 1.0 s | 0 |
| `38f9634f` | n=123, med 1.0 s, p90 2.0 s, max 32.2 s | n=1408, med 1.0 s | 1 |
| `98459df2` | n=18, med 1.0 s, max 4.7 s | n=1441, med 1.0 s | 0 |
| `b4ae7b11` | n=5, med 1.0 s, p90 5.6 s | n=1457, med 1.0 s | 0 |

**One leg out of ~5,800 exceeded 30 s.** A 144-second standstill is therefore
~144 fully-counted one-second legs, every one of them under the threshold. The
gap guard cannot see this case at all — and a corollary worth stating, because it
was a live hypothesis: a long standstill does **not** self-exclude via throttling.

## 4. The one rule

> Time in which the runner covered no ground is not pace time.

§5.2 already holds this when the fixes are absent. It now holds when they are
present. Three consequences follow, and they are the whole slice:

- **At the ends** a standstill has no run around it to belong to. It leaves the
  chart: trimmed off both the x extent and the time.
- **Mid-run** a standstill keeps its **position** in the series: the distance
  grid still advances past it, so the buckets either side stay where they are.
  Its seconds are skipped, and so are the 1.9–4.0 m it crept (§6 explains why
  both, and what that costs).
- **A stop is invisible on a distance axis** (§8), so one of 5 s or more is drawn
  as a dashed rule.

## 5. Detection, and where the constants come from

A fix is **moving** when the distance committed over a **5 s window** reaches
**0.8 m/s**, measuring to the **last fix inside** the window.

**Why 0.8 m/s and not geo's existing 0.5.** `NEAR_STATIONARY_SPEED_MPS` (and
`MIN_MEASURED_SPEED_MPS`, its alias) answers a different question — *is this run
measurable at all*, averaged over the whole run — and reusing it here was tried
first. It under-trims: `98459df2` stays at 18:56 and `b4ae7b11` at 16:32, because
a few seconds of standing mixed with real walking averages above 0.5 m/s. The
band was swept from 0.6 to 1.2 m/s. At 1.0 the readability metric is slightly
better on one capture (80% vs 66% on `38f9634f`) but the floor begins to classify
**genuine slow walking** as stopped — `3ff243b0` contains a real 1.02 m/s stretch,
and at 1.2 m/s the sweep trims 6 s of that run's authentic 1.10 m/s warmup walk.
A C25K beginner may legitimately walk at 0.9 m/s, so the conservative end of the
working band is taken. 0.8 m/s is 20:50 /km: below any real walk, above what the
smoother's 1.5 m near-stationary deadband lets jitter produce.

**Why the last fix inside the window, not the first past its edge.** This is not
a detail. Measuring to the first fix at or beyond the window edge lets a sparse
standstill jump the window forward into real motion and read as moving:
`b4ae7b11`'s stationary 17-second head reads **1.56 m/s** that way and survives
trimming. Measuring to the last fix *inside* the window reads it as 0 m/s. Worth
70% → 84% of usable plot height on that capture alone; the two forms are
otherwise equivalent on the other three.

**Why a window at all, rather than an average from the endpoint.** Averaging
from index 0 outward is immune to sparse fixes but over-trims the tail without
bound: on `38f9634f` the backward average from the final fix stays under 0.8 m/s
for more than 200 s, because the 160-second stand drags it down across real
running. A local window is what stops as soon as the local rate recovers.

## 6. Order of operations

```
fold once  →  trim the ends  →  mark standstills  →  bucket
```

**Fold the whole track once and then operate on the folded array.** Re-folding
from the trimmed head is wrong: `smoothFix` re-seeds on a restart (`startAt`,
plus a 5-fix median window), so a re-fold shifts the committed distances and
breaks the chart's agreement with the stored total that ADR 0021 §3 exists to
guarantee.

Bucketing then differs from today in exactly one way: **a leg both of whose
endpoints are marked stationary is skipped entirely — its seconds and its metres
both** — while its endpoints' committed distance still advances the grid.
Everything else — the entry-leg clock rule, the proportional split of a leg
across the buckets it crosses, the `MAX_GAP_S` skip — is unchanged.

**Why the metres go too, and not just the seconds.** §5.2's entry-leg rule is
that a leg's metres and the time that earned them must travel together; crediting
a standstill's ~2 m to a bucket while withholding its seconds would make that
bucket read ~8% fast on a 23 m width. Skipping both is also exactly what a
`MAX_GAP_S` leg already does, for the same stated reason — such a leg *"committed
no distance to lose"*. Here it commits 1.9–4.0 m, so the buckets sum to the
retained total **less the crept distance: 0.1% or under on all four captures**.
That residue is the honest cost of the rule, and §14 asserts it exactly rather
than claiming a conservation the rule does not deliver.

Trim amounts, at 0.8 m/s over 5 s:

| capture | head | tail | metres lost |
| --- | --- | --- | --- |
| `3ff243b0` | 6 s | — | 4 m |
| `38f9634f` | 47 s | 173 s | 21 m (0.70%) |
| `98459df2` | 5 s | 12 s | 3 m |
| `b4ae7b11` | 17 s | — | 12 m |

## 7. Result

Readability metric at each stage:

| capture | today | + trim ends | + standstill excluded |
| --- | --- | --- | --- |
| `3ff243b0` | 59% (5:46…16:19) | 59% (5:46…16:21) | **85%** (5:46…13:05) |
| `38f9634f` | **4%** (5:11…125:36) | 66% (5:37…12:58) | **85%** (5:37…11:23) |
| `98459df2` | 40% (5:51…18:56) | 82% (5:54…11:57) | **84%** (5:54…11:47) |
| `b4ae7b11` | 47% (5:13…16:32) | 84% (5:13…11:34) | **95%** (5:13…10:51) |

Two things this table is worth reading closely for. **The standstill column is
worth more than the trim column on two of the four captures**, which is why the
slice covers both. And **the mid-run standstill it excludes is tiny** — after
trimming, the four runs contain 3, 2, 2 and 1 standstill stretches totalling
**7 s, 3 s, 2 s and 2 s**. Those few seconds are what move `3ff243b0` from 59% to
85%.

**A duration cap was considered and rejected as measurably inert.** Excluding
only standstills up to 30 s and excluding all of them produce **identical axes on
all four captures**, because once the ends are trimmed every remaining standstill
is short; the only long ones were the 47 s head and 144 s tail already gone. The
cap's one real effect would be a cliff — a 25 s stop cleaned up, a 35 s stop
wrecking the chart worse than today — so no cap is applied.

## 8. Visualising a stop, and why a dashed bridge cannot work

The natural way to draw an excluded stretch is to break the line and bridge the
hole with a dash. **On a distance axis there is no hole.**

A stop covers no ground. Measured creep across the standstills in these
captures: **1.9–4.0 m**, which is **0.07–0.14% of the x axis**. One whole bucket
is `total / 120` = 0.83%. On the card's ~290 pt plot that is **~0.3 pt for the
stop and ~2.4 pt for its bucket**, against the ~12 pt a dash pattern needs before
it reads as dashed rather than as a blip.

And the hole does not exist even in principle: excluding a standstill's seconds
leaves its bucket its metres and its other legs, so the bucket keeps a credible
pace. **No bucket goes null in any of the four captures.** The line stays
continuous; there is nothing to bridge.

Two alternatives were therefore rejected. **Forcing a hole** — nulling the bucket
containing the stop so a dash can span it — buys ~2.4 pt of dash at the cost of
discarding a real bucket of measured pace. **A time x-axis**, on which a 25 s stop
would be 25 s wide and the bridge would work as intended, is a different chart
and contradicts the pace-vs-distance framing the shipped slice chose.

What is drawn instead is a **dashed vertical rule at the stop's distance**, with
the pace line continuous behind it — visible at any stop duration, precise about
where the stop happened, and dashed to signal that it is an annotation and not
pace. Rendered from `3ff243b0`'s real data, the rule at 2.60 km:

```
    5:46 |                   *   *   *          *        * ** *   :
         |           ****     *** * *        *** *    *** *  * *
         |                         *                              :
         |          *       *         *              *
    9:26 |     *  *        *              *        *            * :
         |    * ** *     **            *** **     * *               *
         | ***                                                   *:* *
         |*
   13:05 |                                                        *
         0                                                       2.8 km
```

## 9. Marking policy

**Exclusion is unconditional at any duration; marking has a 5 s floor.** A 1 s dip
below the floor is a footfall or a GPS wobble, not a stop, and marking it would
litter the chart — at a 0 s floor these captures produce 3, 2, 2 and 1 markers
including two 0-second ones and a visual collision in `3ff243b0` at 0.35 km.

Marker counts by floor across the four captures: 0 s → 3/2/2/1; 3 s → 1/1/0/0;
5 s → **1/0/0/0**; 8 s → 0/0/0/0.

**So on the current field captures the 5 s floor yields exactly one rule**
(`3ff243b0`, 6 s at 2.60 km) and the other three show none while still gaining
the pace correction. This is recorded because "no markers" is otherwise easy to
read as a broken feature during verification. 3 s was considered and declined: it
would label a three-second hesitation a stop.

Two stops landing in the same bucket merge into one marker with their durations
summed, so a stop-and-go stretch cannot stack overlapping rules.

## 10. Data model

```ts
export interface ProfileStop {
  distanceM: number;
  durationS: number;
}

export interface RunProfile {
  points: ProfilePoint[];
  stops: ProfileStop[];
}

export function toRunProfile(fixes, bucketCount?): RunProfile
```

`ProfilePoint` is unchanged. Ripples: `RunTrack.profile` becomes
`RunProfile | null`, `isDrawableProfile` and `paceRange` take `profile.points`,
and `RunProfileChart` gains a `stops` prop.

`bucketCount`'s default must derive from the **retained** fix count, not the raw
one — the default is evaluated before trimming today, and a trimmed run has
fewer fixes to spend on buckets.

## 11. Rendering

`CartesianChart`'s children receive `xScale` and `chartBounds`
(`CartesianChartRenderArg`, verified in victory-native's types), so each stop is
one Skia `Line` from `chartBounds.top` to `.bottom` at `xScale(stop.distanceM)`,
carrying a `DashPathEffect` — already imported in this file for the y grid.
Skia's `Line` takes plain `{ x, y }` vectors, so the only wrinkle is aliasing it
against victory-native's own `Line` in the same module.

Styling: `textSecondary`, hairline, with a longer dash interval than the y grid's
`[1, 3]` so the rule reads as an annotation rather than as more grid. Final
values are confirmed on the simulator, not chosen here.

The chart stays the only file importing victory-native (ADR 0024).

## 12. Accessibility

The chart is a Skia canvas with no accessible content, so `RunProfileCard`'s label
is all VoiceOver gets. It gains a stops sentence — *"Stopped once for 6 seconds,
at 2.60 kilometres."* — omitted entirely when there are none. The range sentence
already comes from `paceRange`, which now reports the cleaner span and therefore
stops announcing a 125:36 that told the listener nothing.

## 13. What this reverses

The shipped §5.2 states, and a test pins:

> A stop *without* a pause (a traffic light the runner ran through) still counts
> — that is real elapsed time, and only a bare gap is unmeasured.

`src/domain/run-profile.test.ts` asserts it as *"a standstill with fixes still
counts as time — only gaps are excluded"*, with the rationale *"a traffic light
the runner never paused for is real elapsed time and must slow its bucket"*.

That reasoning assumed a bucket could absorb a standstill. It cannot: §2 measures
6 s of standing moving a bucket by 7 minutes per km, and §3 shows the fixes keep
arriving so nothing else catches it. The claim that the time is *real* is still
true — it is simply not *pace*, and the run's elapsed time is reported by
`RunStatGrid` from `activeDurationS`, which this does not touch.

§5.2 is amended with this measurement rather than silently contradicted, and the
test is rewritten to pin the new rule while keeping its assertion that the stop
stays at its own position in the series.

## 14. Testing

Unit only, in `bun test` — `src/domain/run-profile.ts` is pure TS with no Expo or
React Native import, so the suite runs without a device.

Against synthetic runs (the existing `phasedRun` / `straightRun` helpers already
build these):

- A stationary head, a stationary tail, and a mid-run standstill each restore the
  `bandContrast` metric §5.2's gap tests already use.
- **Distance accounting across a standstill is exact** — the buckets sum to the
  retained total minus the distance crept while stationary, and to the retained
  total exactly when nothing crept. Asserting the residue rather than plain
  conservation is deliberate: §6 skips a standstill leg's metres along with its
  seconds, and a test asserting conservation outright would fail for the right
  reason and get "fixed" by re-crediting those metres.
- **Walking just above the floor is not trimmed.** This is the assertion that
  matters most: it is the one that would hurt a real beginner if 0.8 m/s were
  wrong, and the only one whose failure is invisible on the four captures.
- A stop shorter than the marking floor is excluded from pace but produces no
  `ProfileStop`.
- Two stops in one bucket merge into one marker with summed duration.
- A run that never sustains the floor falls back to the untrimmed fold rather
  than returning nothing.
- The rewritten standstill test from §13.

The four captures are **not** checked in as fixtures — they are 180 kB each and
carry a real route. Their measurements live in this document as evidence; the
suite asserts properties on synthetic runs, per the pace chart design's §9.2
convention of never pinning a magic constant.

**No E2E.** Simulated GPS motion is unreachable by Maestro (ADR 0001, 2026-07-31
amendment), so no flow can drive a standstill. The chart's absence path is
already covered. Verification is a simulator pass on a summary rendered from a
seeded run, plus the device checklist.

## 15. Failure and degradation

- **Trimming removes everything** — a run that never sustains 0.8 m/s over any
  5 s window. Fall back to the untrimmed fold rather than lose the chart.
  `hasMeasuredDistance` (0.5 m/s averaged over the run) already suppresses the
  whole card for such runs, so this is belt-and-braces, not the primary gate.
- **No standstill anywhere** — output identical to today.
- **The x axis maxes at the trimmed distance.** On `38f9634f` that is 2.94 km
  against the stat grid's 2.97 km, 0.7%. The x ticks are half-kilometres, so it
  is invisible in practice; it is recorded here so it is not rediscovered as a
  bug. The card's spoken label continues to quote `run.distanceM`, the stored
  total, because that is the run's distance — the chart merely declines to plot
  the part of it the runner covered while standing.
- **The fold throws** — unchanged: `useRunTrack`'s `foldProfile` already keeps the
  route map alive when the pace fold fails.

## 16. Out of scope

- Elevation. Still unrendered, still waiting on barometer tuning (ADR 0015).
- Any change to recorded distance, `activeDurationS`, splits, or Apple Health.
- Trimming the **route map**. A stationary blob at the end draws as a dot and
  costs nothing; the map's own simplification already handles it.
- Auto-pause, or any change to what the engine records. This is a presentation
  fix over data that is already correct.
