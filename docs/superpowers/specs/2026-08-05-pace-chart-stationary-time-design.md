# Pace chart: standstill time is not pace time — design

Date: 2026-08-05
Status: **design — awaiting approval**
Revision: **2**. Revision 1 proposed a speed-threshold detector over a 5 s window,
an end-trim, and a dashed stop marker. Three independent adversarial reviews found
six Criticals in it, including one that would have deleted the chart entirely for
the app's slowest users. §16 records what they found and what replaced it. The
diagnosis (§2, §3) survived all three reviews unchanged; the remedy was rebuilt.

Refines the pace chart shipped in the
[run elevation & pace chart slice](2026-08-02-run-elevation-and-pace-chart-design.md).
That slice's §5.2 fixed one shape of this defect — a bare timestamp gap — and
explicitly decided the other shape was correct behaviour. §15 records the
measurement that overturns it.

Measured against four field captures, exported by the
[field-test capture protocol](../../field-test-capture-protocol.md). `active` is
`activeDurationS` from each export's header, not the first-to-last-fix span:

| capture | session | distance | active | fixes |
| --- | --- | --- | --- | --- |
| `runbro-20260731-1421-3ff243b0` | w3d3 | 2765 m | 1415 s | 1414 |
| `runbro-20260731-1542-38f9634f` | w3d1 | 2966 m | 1590 s | 1532 |
| `runbro-20260803-1722-98459df2` | w3d1 | 2934 m | 1456 s | 1460 |
| `runbro-20260803-1753-b4ae7b11` | w3d2 | 3108 m | 1469 s | 1463 |

**Sample caveat, stated up front:** one runner, one phone, one city, all four in
week 3. No W1/W2 capture, and no capture of a genuinely slow walker — the slowest
sustained walk in the sample is ~1.3 m/s. §14 therefore covers the slow-walker
case with synthetic tests, because the field data cannot. All four captures also
sit at the same operating point (`bucketCount` = 120, bucket width 23–26 m), so
nothing here exercises the short-run regime.

---

## 1. What this slice is

**One rule in the pace fold**, stated in §4 and implemented in §5, plus one line
of text on the card.

**It is not:** any change to recorded distance, `activeDurationS`, the splits,
Apple Health, the route map, or what is stored. No trimming, no new threshold
constant, no marker layer, and **no change to `toRunProfile`'s return type**.
Nothing new is persisted and no dependency is added, so the native fingerprint is
untouched and the next release stays OTA-eligible (ADR 0012).

## 2. The defect

The chart buckets by **distance** and each bucket's pace is `seconds / metres`
(§5.2 of the pace chart design). That is the right series for a pace-vs-distance
chart, and it makes a stationary runner a **pole**: seconds accrue while metres
do not, so the bucket's pace grows without bound.

Measured with the shipped `toRunProfile`, worst bucket against the run's median:

| capture | worst bucket | vs median |
| --- | --- | --- |
| `3ff243b0` | #112 = 16:19 | 1.79× |
| `38f9634f` | #119 = **125:36** | **15.90×** |
| `98459df2` | #119 = 18:56 | 2.21× |
| `b4ae7b11` | #0 = 16:32 | 1.99× |

The y axis auto-fits to the extreme, so the run's genuine signal is squeezed into
whatever is left. On `38f9634f` one bucket — 24.7 m of ground carrying 186 s, of
which 169 s is motion below 0.1 m/s — owns almost the whole axis:

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

**`3ff243b0` is not a counter-example.** It has no standing at its ends, so it was
first read as a control case whose 16:19 bucket was genuinely slow walking. It is
not: bucket #112 is a **6-second stop at 2.60 km**. That bucket holds 23.04 m over
22.55 s, and its own non-stationary legs (1.09–1.65 m/s) work out to **11:53 /km**
— so the stop costs that bucket **2:49 /km**, and after this change it reads
13:02. *(Revision 1 claimed "~9:00 to 16:19", a 7:19 effect. That compared the
bucket against the whole run's median, not against its own walking pace. The real
effect is 2.6× smaller and is the number §15 relies on.)*

Reclassifying this capture from control to positive case is worth flagging as a
confirmation risk: after it, all four captures support the conclusion.

## 3. Why the shipped guard misses it

§5.2 excludes any leg longer than `MAX_GAP_S` (30 s), which is correct for a pause
or a tunnel: the fixes are *absent*, and such a leg committed no distance to lose.
It assumed a standstill would look the same. **It does not, because iOS keeps
delivering fixes while the phone stands still.**

Across all four captures: **5,865 legs, of which exactly 1 exceeds `MAX_GAP_S`** —
and that one is `38f9634f`'s fix #0→#1, before the run's own start. Median
inter-fix interval is **1.00 s whether moving or stationary**; the longest
stationary intervals are 1.5 / 32.2 / 4.7 / 5.6 s.

So a 173-second standstill arrives as ~173 fully-counted one-second legs. The gap
guard cannot see this case, and the hypothesis that a long standstill would
self-exclude through location throttling is measurably false. Note the sample's
one over-30 s leg sits in a head that no longer needs special handling, so **the
sample contains no >30 s leg inside a mid-run stand** — the guard's blindness here
is established by the cadence measurement, not by a counter-example.

## 4. The rule

> A bucket's time is the time in which its distance was actually covered.

§5.2 already holds this when fixes are absent. It now holds when they are present.
The pivot from revision 1 is *where the test lives*: not on a fix's windowed
speed, but on **the leg's own committed distance**, which `smoothFix` already
returns as `acceptedDeltaMeters` (ADR 0021 §2d).

That single change is what removes the trim, the 0.8 m/s constant, the marker
layer and the API change — see §16.

## 5. Implementation

Fold the track once with the existing smoother, keeping each leg's
`acceptedDeltaMeters`. Then every leg falls into exactly one of three cases:

1. **It committed distance.** Unchanged from today: its metres and its seconds
   split proportionally across the buckets it crosses, plus any seconds carried
   from case 3.
2. **It committed nothing, and sits in a run of non-committing legs longer than
   the accrual guard.** This is a **stop**: it contributes no seconds. It has no
   metres to contribute either, which is what makes the rule safe.
3. **It committed nothing, and its non-committing run is within the guard.** This
   is the smoother's **deadband accrual**, not a stop. Its seconds **carry
   forward** onto the next committing leg, so the distance and the time it took
   travel together.

**The accrual guard is 3 s, derived not invented:**
`NEAR_STATIONARY_DEADBAND_M / NEAR_STATIONARY_SPEED_MPS` = 1.5 / 0.5 — the longest
the deadband can legitimately hold distance for a runner still moving at the
measurable floor.

**Case 3 is not optional, and no reviewer caught it.** `geo.ts:332` commits when
`smoothedSpeed >= 0.5 || d >= 1.5`, so a walker under 0.5 m/s accrues silently and
then commits ~1.5 m in one leg. Dropping those legs' seconds instead of carrying
them reports that walker **four times too fast**:

| true ground speed | true pace | case 3 carried | case 3 dropped |
| --- | --- | --- | --- |
| 0.4 m/s | 41:40 | **41:43** | 10:26 |
| 0.5 m/s | 33:20 | **33:22** | 8:21 |
| 0.6 m/s and above | — | exact | exact (no accrual legs) |

At 0.6 m/s and above every leg commits, so cases 2 and 3 never fire on a moving
runner at all.

**The `legMeters <= 0` branch at `run-profile.ts:66-70` is deleted**, replaced by
cases 2 and 3. Revision 1 said "everything else is unchanged", which left that
branch — the actual pole generator — in place while claiming to fix it.

## 6. Measured properties

Each of these is a property of the rule, not of the sample.

**It cannot delete real movement.** A leg that committed distance is never
excluded, by construction. Revision 1's window detector could and did: it deleted
a leg at **1.90 m/s** as standstill — above that runner's median walking speed —
while retaining 2 s of exactly-zero motion two legs later.

**It cannot shorten the x extent.** An excluded leg committed no distance, so
there is none to remove. Measured chart extent against stored distance:
2.76 / 2.97 / 2.93 / 3.11 km against 2765 / 2966 / 2934 / 3108 m — exact on all
four. Revision 1's trim shortened the axis by up to 0.7% on the sample and up to
**20.6%** on a synthetic slow walker; that failure mode is gone, and with it the
need to set the x domain explicitly.

**Distance conservation is exact.** The excluded legs committed **0.00 m** on all
four captures, so the buckets sum to the run total with no residue. Revision 1
skipped real metres and needed a residue clause; this does not.

**A stop's damage is bounded and independent of its length.** Synthetic
300 s @2.8 m/s → stop → 300 s @2.8 m/s, 20 buckets, steady pace 5:57:

| stop | slowest bucket | seconds excluded |
| --- | --- | --- |
| 5 s | 6:46 | 0 |
| 25 s | **6:38** | 21 |
| 60 s | **6:38** | 56 |
| 144 s | **6:38** | 140 |

Today those four produce progressively worse poles without limit. The residual
6:38 against 5:57 is the Kalman velocity decay either side of the stop — real
deceleration, correctly kept.

**No run loses its chart.** All 120 buckets stay measured at every steady speed
from 0.4 to 1.4 m/s. Revision 1's 0.8 m/s floor produced **0 of 120 buckets and no
chart at all** at exactly 0.80 m/s, inside the 0.5–0.8 m/s band that
`MIN_MEASURED_SPEED_MPS` deliberately supports.

**Exclusion has a floor, and it is ~5 s of standing, not "any duration".** Case 2
needs a non-committing run longer than 3 s, and the smoother's velocity decay
means a real stop takes a second or two to stop committing. The 5 s synthetic stop
above excludes nothing. Revision 1 claimed exclusion was unconditional at any
duration; that was false, and §14's acceptance test built on it was unsatisfiable.

## 7. Result

The metric is **ground-truth band contrast**: `(walk pace − run pace) / axis span`,
where the run and walk paces come from the capture's **own recorded segments**.
Same form as the shipped `bandContrast`, with real ground truth in the numerator.

| capture | run | walk | band | today | **after** |
| --- | --- | --- | --- | --- | --- |
| `3ff243b0` | 6:32 | 10:21 | 3:49 | 0.36 | **0.52** |
| `38f9634f` | 6:35 | 8:51 | 2:15 | 0.02 | **0.27** |
| `98459df2` | 6:42 | 9:07 | 2:25 | 0.18 | **0.38** |
| `b4ae7b11` | 6:04 | 9:15 | 3:11 | 0.28 | **0.41** |

Axis span, today → after: `5:46…16:19` → `5:46…13:02`; `5:11…125:36` →
`5:11…13:26`; `5:51…18:56` → `5:51…12:07`; `5:13…16:32` → `5:13…12:56`.

`38f9634f` improves 13× and still only reaches 0.27, because its own run and walk
paces are just 2:15 apart — that ceiling is a property of the run, not of the fix.

### 7.1 Why revision 1's metric was thrown away

Revision 1 measured `(p95 − min) / (max − min)` over bucket paces and reported
4–59% → 84–95%. That metric is invalid, and the numbers it produced were roughly
**2× inflated** against the table above.

- **It saturates.** p95 of 120 buckets discards the top six, so six or more
  wrecked buckets put p95 among them. Measured on a clean synthetic: clean chart
  **92.1%**, one poled bucket **10.2%**, five **11.1%**, six or more **100.0%**.
  Non-monotonic, and perfect for the worst input.
- **It would have rejected this slice.** On a synthetic 8 × (200 s running + 20 s
  stop) — exactly the stop-and-go run this slice serves — the fix improves the
  axis from `6:10…16:22` to `6:10…8:26` and the metric goes **99% → 97%**.
- **It is self-referential**, putting p95 of the distribution in the numerator,
  and it is blind to fast-side outliers.
- Revision 1 also claimed it was "the same quantity §5.2's gap tests assert as
  `bandContrast`". It is not: `bandContrast` takes its numerator from fixture
  ground truth.

**A duration cap was considered and rejected.** Bounding exclusion at 30 s is
inert here — post-fix every remaining standstill is short — and it would create a
cliff where a 35 s stop stays as bad as today while a 25 s stop is cleaned up.

## 8. Why no stop marker

A stop covers no ground, so on a distance axis it has no width: the standstills in
these captures creep 0.00–12.57 m, which is 0.02–0.37% of the axis, or **~1 pt on
the card's ~290 pt plot** against the ~12 pt a dash pattern needs to read as
dashed. And no bucket goes null under this rule in any configuration on any
capture, so the line stays continuous — there is nothing to bridge.

A dashed vertical rule was designed in revision 1 and cut. Three findings killed
it: victory clips chart children to `chartBounds`, whose x domain runs from the
first bucket **centre** to the last, so on 3 of the 4 captures every marker fell in
the clipped outer half-bucket and drew nothing; the chart already carries ~5 solid
full-height vertical x-gridlines and a dashed y-grid, so "dashed vertical hairline"
is not a distinguishable semantic; and it fired **once across four runs** while
contributing nothing to the measured gain.

So a mid-run stop is simply spanned by the continuous line, which is the owner's
decision of 2026-08-06.

## 9. What the card must disclose

Excluding standstill time makes the chart's pace basis differ from
`activeDurationS`, which every other figure on the summary uses. Measured as the
chart's distance-weighted mean pace against the Avg Pace tile:

| capture | today | after |
| --- | --- | --- |
| `3ff243b0` | +0.1% | −0.7% |
| `38f9634f` | +0.4% | **−10.3%** |
| `98459df2` | +0.2% | −0.8% |
| `b4ae7b11` | +0.3% | −0.1% |

The chart currently agrees with the tile to within 0.4% on all four; after this it
diverges by 10.3% on the one capture with material standing time. That is the
divergence prior §5.2 was partly written to close, so it is **disclosed rather
than left silent** (owner's decision, 2026-08-06 — "preferably no").

`RunProfileCard` gains one line of secondary text whenever excluded standstill
time is material — *"Excludes 3:14 standing"* — and the same sentence joins the
VoiceOver label. This is also what replaces the cut marker layer: unlike a marker,
it covers standing anywhere in the run, states the magnitude, is legible without a
legend, and is real `Text` so VoiceOver reads it for free.

**There is deliberately no "material" threshold.** The line appears whenever any
standstill was excluded, because by §6 that already means a genuine stop was found
— inventing a second constant to decide when a stop is worth mentioning is what
revision 1 did with its 5 s marker floor, and it went badly. On the sample that
means the line reads *"Excludes 0:05 standing"* on `3ff243b0`, *0:10* on
`98459df2`, *0:06* on `b4ae7b11` and *3:14* on `38f9634f`. Three of those are
small, and saying so costs nothing; the alternative is a chart that quietly
disagrees with the tile above it.

## 10. Data model

**Unchanged.** `toRunProfile` still returns `ProfilePoint[]`; `ProfilePoint` still
carries `distanceM` and `paceSecPerKm`. Revision 1 introduced `RunProfile` and
`ProfileStop` solely to carry the marker layer, rippling through `RunTrack`,
`isDrawableProfile`, `paceRange`, `RunProfileChart`'s props and ~17 test call
sites. Cutting the marker cuts all of it.

One fact the fold must expose to the card for §9, and nothing more: the total
excluded standstill seconds. This is an additive field, not a shape change.

`bucketCount`'s default still derives from the fix count. No fixes are removed —
only some legs' seconds are — so bucket width is unaffected and the prior design's
"a stationary stretch shrinks the bucket width" defect is not reintroduced.
Revision 1's trim did remove fixes and did need the default recomputed; that
instruction is withdrawn along with the trim. *(Note the interaction is untested by
the sample: all four captures sit at the 120-bucket cap.)*

## 11. Rendering

**Unchanged.** No new chart element, no Skia import, no clip interaction, no draw
order question, no `Line` name collision. `RunProfileChart` keeps its single pace
`Line` and its existing inverted `paceDomain`, which now auto-fits to a range with
no pole in it.

The chart stays the only file importing victory-native (ADR 0024).

## 12. Accessibility

`RunProfileCard`'s label is all VoiceOver gets, since the chart is a Skia canvas.
Two corrections beyond §9's sentence:

- The label quotes `run.distanceM`, and under this rule that is exactly the
  chart's extent (§6), so the number is now true. Revision 1 kept the stored total
  while trimming the axis, which would have announced 2.97 km for a 2.94 km chart
  — using a claim about invisible x-ticks to excuse an error in the channel that
  has no ticks.
- The range sentence from `paceRange` improves for free: it stops announcing a
  125:36 that told the listener nothing.

## 13. Failure and degradation

- **A run with no committing legs at all** — every leg inside a >3 s
  non-committing run. Every bucket is null, `isDrawableProfile` returns false, and
  the card renders nothing. `hasMeasuredDistance` already suppresses the whole
  card for such a run. No fallback is needed, because unlike revision 1 this
  cannot happen to a run that was actually moving (§6).
- **No standstill anywhere** — output identical to today, since cases 2 and 3
  never fire.
- **A gap over `MAX_GAP_S`** — unchanged; still skipped.
- **The fold throws** — unchanged: `useRunTrack`'s `foldProfile` already keeps the
  route map alive when the pace fold fails, and the route's geometry is computed
  independently of it.

## 14. Testing

Unit only, in `bun test` — `src/domain/run-profile.ts` is pure TS with no Expo or
React Native import.

The suite asserts **ground-truth band contrast** (§7's metric) on synthetics, never
revision 1's p95 metric, and never a magic constant.

- **A stationary head, a stationary tail, and a mid-run stop** each improve band
  contrast, and a stop's slowest bucket is **independent of the stop's length**
  (25 s, 60 s and 144 s must agree). This is the property; the pole's absence is
  what the test pins.
- **The slow-walker assertions the field data cannot cover** — and revision 1
  omitted, testing only the direction that could not fail:
  - a steady walker at 0.4 and 0.5 m/s is reported within ~1% of true pace, which
    fails 4× wide without case 3's carry-forward;
  - every steady speed from 0.4 to 1.4 m/s keeps all buckets measured, so no run
    loses its chart;
  - **a leg that committed distance is never excluded**, at any speed.
- **Distance is conserved exactly** — the buckets sum to the run total, with no
  residue clause.
- **A gap over `MAX_GAP_S` is still skipped** — the existing gap tests must pass
  unchanged.
- The rewritten standstill test from §15.

The four captures are **not** checked in — 180 kB each, carrying a real route.
Their measurements live here as evidence. Worth reconsidering later: a decimated
fixture of committed deltas and timestamps only, with lat/lng dropped, would make
§7's table reproducible after the code lands without the privacy objection.

**No E2E.** Simulated GPS motion is unreachable by Maestro (ADR 0001, 2026-07-31
amendment). Verification is a simulator pass on a seeded run, plus the device
checklist.

## 15. What this reverses

The shipped §5.2 states, and `run-profile.test.ts` pins:

> A stop *without* a pause (a traffic light the runner ran through) still counts —
> that is real elapsed time, and only a bare gap is unmeasured.

That reasoning assumed a bucket could absorb a standstill. It cannot: §2 measures
a 6 s stop costing its bucket **2:49 /km**, and §3 shows the fixes keep arriving so
nothing else catches it. The time is still real — it is simply not the time in
which that distance was covered — and the run's elapsed time is still reported in
full by `RunStatGrid` from `activeDurationS`, with §9 disclosing the difference.

§5.2 is amended with this measurement rather than silently contradicted.

**The test rewrite is larger than revision 1 claimed.** That revision promised to
keep the test's assertion "that the stop stays at its own position in the series".
No such assertion exists: `run-profile.test.ts:210-226` asserts only
`max > 1.2 × steady` and `min ≈ steady`. So the positional property is *unpinned*
today and must be added, not preserved. Verified by running the shipped suite
against a faithful implementation of this rule: **19 pass, 1 fail**, the failure
being exactly that `max > 1.2 × steady` line.

## 16. Review record

Three independent adversarial reviews, 2026-08-05, each with its own angle and no
knowledge of the others. Revision 1's diagnosis survived; its remedy did not.

**Criticals that forced the rewrite:**

1. §6 left `run-profile.ts:66-70`, the pole generator, in place while claiming to
   fix it (§5).
2. The window detector deleted real movement and retained real standstill — a leg
   at 1.90 m/s excluded, 2 s of zero motion kept (§6).
3. The 0.8 m/s floor deleted the chart entirely at exactly 0.80 m/s, inside the
   band `MIN_MEASURED_SPEED_MPS` supports; the stated fallback did not fire (§6).
4. A degenerate window resolved to "stationary", firing on every run's final fix
   and manufacturing phantom multi-minute stops at 3–10 s fix intervals — reachable
   because ADR 0008's locked-phone heartbeat does not guarantee 1 Hz.
5. "Exclusion is unconditional at any duration" was false, making a listed
   acceptance test unsatisfiable (§6).
6. The chart's pace basis diverged from every other figure on the screen, silently
   (§9).

**The metric was invalid** (§7.1), so revision 1's headline table was ~2× inflated.

**The marker layer was cut** after three findings (§8).

**Two reviewers contradicted each other**, which is itself the strongest evidence
for the under-specification finding: each reconstructed revision 1's detector
differently from the same document and reached opposite conclusions about whether
half the slice did anything. One concluded the standstill exclusion was worth
nothing on three of four captures; that rested on a misidentified detector — it
swept forward/backward/OR/AND applied uniformly, while the prototype used a forward
window at the head and a backward one at the tail. This revision's rule has no
direction, no window and no combination rule to misread.

**Corrections to figures carried into this revision:** the `active` column was the
fix wall span, not `activeDurationS` (`38f9634f` off by 38 s); §2's effect was
7:19 and is 2:49; "two of four captures" was one of four; the creep range 1.9–4.0 m
was 0.00–12.57 m; the 0.1% residue was ~0.33% and is now exactly 0; "144 s" and
"173 s" were the same stretch; and two illustrative figures (a 1.56 m/s window
reading, "1.0 m/s → 80%") did not reproduce, though both conclusions did.

**The 0.9 m/s beginner-walk claim was unsupported** and is gone with the constant
it justified. Every walk segment in the sample runs 1.43–1.95 m/s; there is no
sustained sub-1.3 m/s walking, and extending revision 1's truncated sweep showed
its own metric arguing for a 1.6–1.8 m/s floor — one that would delete the walk
intervals. The current rule needs no such constant, and §14 tests the slow-walker
case synthetically instead of asserting a belief about it.

**Findings that survived all three reviews:** §3's cadence measurement, §2's
worst-bucket table, "fold once, never re-fold from a trimmed head" (`smoothFix`
re-seeds velocity on restart, so a re-fold shifts committed distances), "no bucket
goes null, so there is nothing to bridge", and §1's fingerprint/OTA claim.

## 17. Out of scope

- Elevation. Still unrendered, still waiting on barometer tuning (ADR 0015).
- Any change to recorded distance, `activeDurationS`, splits, or Apple Health.
- **The x-axis revisit.** The prior design chose distance for elevation's sake,
  deferred elevation, and kept the axis as the owner's standing decision "revisited
  when elevation lands". A reviewer argued this slice is that revisit and that a
  time axis would dissolve the whole problem — a stop would be as wide as it is
  long. That is a real question and it is not this slice's to answer; it belongs
  with the elevation work the axis was chosen for.
- Per-segment or segment-coloured pace. `segmentSeq` is already at the fold site
  and `SegmentSplits` already reports per-interval pace; whether the chart should
  use that structure is a design question, not a defect fix.
- Clipping fixes to `[startedAt, endedAt]`. A reviewer found each capture's fix #0
  precedes `startedAt` by 1.3–31.8 s at 0.00 m committed. It is free and
  threshold-less, but under this rule those legs are already excluded as a stop,
  so it would change nothing here. Worth remembering for the engine.
